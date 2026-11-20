import { describe, expect, it } from 'vitest';

import type { ConnectionState } from '../../src/client/index.ts';
import {
	CLOSE_CROWDED,
	CLOSE_EXPIRED,
	CLOSE_RATE_LIMITED,
	CLOSE_REFUSED,
	CLOSE_STALE,
	CLOSE_SUPERSEDED,
	CLOSE_TOO_LARGE,
	PONG,
} from '../../src/protocol.ts';
import type { ServerFrame } from '../../src/protocol.ts';
import { attached, message, rig, settle, UNOPENABLE } from './helpers/rig.ts';

const never = () => new Promise<string>(() => {});

describe('retries', () => {
	it('go on without limit: after 250 ms, doubling to 4 s, then 5, 10 and 20 s, then every 30 s', async () => {
		const { transport, clock, sockets, socket } = rig();
		transport.onMessage('a', 'note', () => {});
		const waits = [250, 500, 1000, 2000, 4000, 5000, 10_000, 20_000, 30_000, 30_000, 30_000];

		for (const [failures, wait] of waits.entries()) {
			(await socket()).drop();
			await clock.advance(wait - 1);
			expect(sockets, `before retry ${failures + 1}`).toHaveLength(failures + 1);
			await clock.advance(1);
			expect(sockets, `retry ${failures + 1}`).toHaveLength(failures + 2);
		}
	});

	it.each([
		{ rhythm: 'start again', answered: 'the object answered', answers: true, wait: 250 },
		{ rhythm: 'go on', answered: 'only its ping was answered', answers: false, wait: 2000 },
	])('$rhythm, with $wait ms, after a socket on which $answered', async (row) => {
		const { transport, clock, sockets, socket, letIn } = rig();
		transport.onMessage('a', 'note', () => {});
		for (const wait of [250, 500, 1000]) {
			(await socket()).drop();
			await clock.advance(wait);
		}

		const open = await letIn();
		if (row.answers) open.hear(attached('a'));
		open.drop();
		await clock.advance(row.wait - 1);
		expect(sockets).toHaveLength(4);
		await clock.advance(1);

		expect(sockets).toHaveLength(5);
	});

	it.each([
		{ close: 'for no reason it gives', code: 1006, wait: 250 },
		{ close: 'as refused', code: CLOSE_REFUSED, wait: 5000 },
	])('follow $wait ms after a connected socket closes $close', async (row) => {
		const { transport, clock, sockets, letIn } = rig();
		transport.onMessage('a', 'note', () => {});
		(await letIn()).drop(row.code);

		await clock.advance(row.wait - 1);
		expect(sockets).toHaveLength(1);
		await clock.advance(1);

		expect(sockets).toHaveLength(2);
	});

	// Each close the object gives a reason for, and what the client does next.
	it.each([
		{ close: 'as stale, its pings having stopped', code: CLOSE_STALE, wait: 0 },
		{ close: 'as expired, to be judged again', code: CLOSE_EXPIRED, wait: 0 },
		{ close: 'as crowded out by its newer sockets', code: CLOSE_CROWDED, wait: 5000 },
		{ close: 'for a frame too large', code: CLOSE_TOO_LARGE, wait: 5000 },
		{ close: 'for frames too fast', code: CLOSE_RATE_LIMITED, wait: 5000 },
	])('follow $wait ms after a connected socket closes $close, and no refusal', async (row) => {
		const { transport, clock, sockets, letIn } = rig();
		transport.onMessage('a', 'note', () => {});
		(await letIn()).drop(row.code);

		// Just short of the wait, or none at all where there is none.
		await clock.advance(Math.max(0, row.wait - 1));
		const before = sockets.length;
		await clock.advance(row.wait > 0 ? 1 : 0);

		expect([before, sockets.length]).toEqual([row.wait > 0 ? 1 : 2, 2]);
		expect(transport.refusal).toBeNull();
	});

	// Clients cut together do not come back together: each wait is cut short by a random part of its fifth.
	it.each([
		{ random: 0, wait: 250 },
		{ random: 0.999, wait: 200 },
	])('carry jitter: with a draw of $random, the first follows $wait ms', async (row) => {
		const { transport, clock, sockets, socket } = rig({ random: () => row.random });
		transport.onMessage('a', 'note', () => {});
		(await socket()).drop();

		await clock.advance(row.wait - 1);
		expect(sockets).toHaveLength(1);
		await clock.advance(1);

		expect(sockets).toHaveLength(2);
	});

	// Sockets accepted together expire together: their returns are spread over a second.
	it.each([
		{ random: 0, wait: 0 },
		{ random: 0.5, wait: 500 },
	])('after an expiry, with a draw of $random, follow $wait ms', async (row) => {
		const { transport, clock, sockets, letIn } = rig({ random: () => row.random });
		transport.onMessage('a', 'note', () => {});
		(await letIn()).drop(CLOSE_EXPIRED);

		await clock.advance(Math.max(0, row.wait - 1));
		const before = sockets.length;
		await clock.advance(row.wait > 0 ? 1 : 0);

		expect([before, sockets.length]).toEqual([row.wait > 0 ? 1 : 2, 2]);
	});

	// A socket that only holds hears nothing but pongs; one that stayed up through a
	// heartbeat was a connection all the same.
	it.each([
		{ up: 'through a heartbeat', ms: 15_000, wait: 250 },
		{ up: 'for less than a heartbeat', ms: 14_999, wait: 2000 },
	])('start again once a held socket has stayed up $up', async (row) => {
		const { transport, clock, sockets, socket, letIn } = rig();
		transport.hold();
		for (const wait of [250, 500, 1000]) {
			(await socket()).drop();
			await clock.advance(wait);
		}

		const open = await letIn();
		await clock.advance(row.ms);
		open.hear(PONG);
		open.drop();
		await clock.advance(row.wait - 1);
		expect(sockets).toHaveLength(4);
		await clock.advance(1);

		expect(sockets).toHaveLength(5);
	});
});

describe('a change listener', () => {
	it('that stops listening while told of a change is not told again, and the others are', async () => {
		const { transport, letIn } = rig();
		const told: string[] = [];
		const stop = transport.onChange(() => {
			told.push('stopping');
			stop();
		});
		transport.onChange(() => told.push('staying'));

		transport.onMessage('a', 'note', () => {});
		(await letIn()).drop();

		expect(told).toEqual(['stopping', 'staying', 'staying', 'staying']);
	});
});

describe('checkNow', () => {
	it('cuts the wait before the next retry, and the rhythm goes on from where it was', async () => {
		const { transport, clock, sockets, socket } = rig();
		transport.onMessage('a', 'note', () => {});
		(await socket()).drop();
		await clock.advance(250);
		(await socket()).drop();

		transport.checkNow();
		await settle();
		expect(sockets).toHaveLength(3);

		(await socket()).drop();
		await clock.advance(999);
		expect(sockets).toHaveLength(3);
		await clock.advance(1);
		expect(sockets).toHaveLength(4);
	});

	it('asks an open socket whether it is there, once, and gives it up unanswered', async () => {
		const { transport, clock, letIn } = rig();
		transport.onMessage('a', 'note', () => {});
		const open = await letIn();

		transport.checkNow();
		transport.checkNow();

		expect(open.pings).toBe(2);
		await clock.advance(5000);
		expect(open.closed).toBeDefined();
		expect(transport.isConnected).toBe(false);
	});

	it.each([
		{ when: 'a connect is in flight', wants: true, asks: 1 },
		{ when: 'nothing is wanted', wants: false, asks: 0 },
	])('starts no connect when $when', async (row) => {
		const { transport, asks } = rig();
		if (row.wants) transport.onMessage('a', 'note', () => {});
		await settle();

		transport.checkNow();
		await settle();

		expect(asks()).toBe(row.asks);
	});
});

describe('the heartbeat', () => {
	it.each<{ answer: string; hears: ServerFrame | typeof PONG | undefined; givenUp: boolean }>([
		{ answer: 'a pong', hears: PONG, givenUp: false },
		{ answer: 'any frame', hears: message('a', 1), givenUp: false },
		{ answer: 'nothing', hears: undefined, givenUp: true },
	])(
		'pings every 15 s, and a socket answering $answer within 5 s is given up: $givenUp',
		async (row) => {
			const { transport, clock, letIn } = rig();
			transport.onMessage('a', 'note', () => {});
			const open = await letIn();
			open.hear(attached('a'));
			await clock.advance(14_999);
			expect(open.pings).toBe(1);
			await clock.advance(1);
			expect(open.pings).toBe(2);

			if (row.hears) open.hear(row.hears);
			await clock.advance(4999);
			expect(transport.isConnected).toBe(true);
			await clock.advance(1);

			expect(transport.isConnected).toBe(!row.givenUp);
			expect(open.closed !== undefined).toBe(row.givenUp);
			expect(transport.error === null).toBe(!row.givenUp);
		},
	);

	it('replaces a silent socket, resumes on the new one, and is deaf to the old one after', async () => {
		const { transport, clock, sockets, letIn } = rig();
		const heard: unknown[] = [];
		transport.onMessage('a', 'note', (data) => heard.push(data));
		const silent = await letIn();
		silent.hear(attached('a', { seq: 3 }));
		await clock.advance(20_000);
		await clock.advance(250);

		const next = await letIn();
		next.hear(attached('a', { resumed: true, seq: 3 }));
		// The object closes the socket this one replaced, and what was in flight on it lands late.
		silent.hear(message('a', 4, 'from the socket given up'));
		silent.drop(CLOSE_SUPERSEDED);
		await clock.advance(10_000);

		expect(next.frames[0]).toMatchObject({ t: 'hello', attach: [{ channel: 'a', since: 3 }] });
		expect(heard).toEqual([]);
		expect(transport.connectionState).toBe('connected');
		expect(sockets).toHaveLength(2);
	});
});

describe('a connect', () => {
	it.each([
		{ what: 'a socket that never opens', answer: () => 'wss://object.test/socket', sockets: 2 },
		{
			what: 'an address that never answers',
			answer: (ask: number) => (ask === 1 ? never() : 'wss://object.test/socket'),
			sockets: 1,
		},
	])('is given up after 10 s waiting on $what, and tried again', async (row) => {
		const { transport, clock, sockets, asks, letIn } = rig({ answer: row.answer });
		transport.onMessage('a', 'note', () => {});
		await clock.advance(9999);
		expect(transport.error?.message ?? '').not.toContain('in time');

		await clock.advance(1);
		expect(transport.error?.message).toContain('in time');
		await clock.advance(249);
		expect(asks()).toBe(1);
		await clock.advance(1);
		await letIn();

		expect(asks()).toBe(2);
		expect(sockets).toHaveLength(row.sockets);
		// The socket that never opened was closed, not left to open later.
		expect(sockets.slice(0, -1).every((socket) => socket.closed)).toBe(true);
		expect(transport.isConnected).toBe(true);
	});

	it.each([
		{ address: 'rejects', answer: () => Promise.reject<string>(new Error('no ticket')) },
		{
			address: 'throws',
			answer: (): string => {
				throw new Error('no ticket');
			},
		},
		{ address: 'answers with one no socket can be opened to', answer: () => UNOPENABLE },
	])('fails at once when the address $address, and is retried on the rhythm', async (row) => {
		const { transport, clock, sockets, asks, letIn } = rig({
			answer: (ask) => (ask === 1 ? row.answer() : 'wss://object.test/socket'),
		});
		transport.onMessage('a', 'note', () => {});
		await settle();
		expect(transport.connectionState).toBe('disconnected');
		expect(transport.error).toBeInstanceOf(Error);
		expect(sockets).toHaveLength(0);

		await clock.advance(249);
		expect(asks()).toBe(1);
		await clock.advance(1);
		expect(asks()).toBe(2);
		await letIn();

		expect(transport.isConnected).toBe(true);
		expect(transport.error).toBeNull();
	});

	it('opens no socket to an address that answers after its attempt was given up', async () => {
		let answerLate = (_address: string) => {};
		const { transport, clock, sockets } = rig({
			answer: (ask) =>
				ask === 1
					? new Promise<string>((resolve) => {
							answerLate = resolve;
						})
					: `wss://object.test/socket?ticket=${ask}`,
		});
		transport.onMessage('a', 'note', () => {});
		await clock.advance(10_000);

		answerLate('wss://object.test/socket?ticket=1');
		await settle();
		expect(sockets).toHaveLength(0);
		await clock.advance(250);

		expect(sockets.map((socket) => socket.url)).toEqual([
			`wss://object.test/socket?ticket=2&client=${transport.clientId}`,
		]);
	});

	it('asks for a new address every time, and names itself the same on each', async () => {
		const { transport, clock, sockets, asks, socket } = rig({
			answer: (ask) => `wss://object.test/socket?ticket=${ask}`,
		});
		transport.onMessage('a', 'note', () => {});
		for (const wait of [250, 500]) {
			(await socket()).drop();
			await clock.advance(wait);
		}
		await settle();

		expect(asks()).toBe(3);
		expect(transport.clientId).toMatch(/^[\w-]{16,}$/);
		expect(sockets.map((opened) => opened.url)).toEqual(
			[1, 2, 3].map((ask) => `wss://object.test/socket?ticket=${ask}&client=${transport.clientId}`),
		);
		expect(rig().transport.clientId).not.toBe(transport.clientId);
	});

	it('puts its client id on an address that has no query', async () => {
		const { transport, socket } = rig({ answer: () => 'wss://object.test/socket' });
		transport.onMessage('a', 'note', () => {});

		expect((await socket()).url).toBe(`wss://object.test/socket?client=${transport.clientId}`);
	});
});

describe('the fault', () => {
	it.each([
		{ through: 'one connect still in flight', retries: [] },
		{ through: 'five retries that failed', retries: [250, 500, 1000, 2000, 4000] },
	])('shows once there has been no connection for 8 s, through $through', async (row) => {
		const { transport, clock, sockets, socket } = rig();
		transport.onMessage('a', 'note', () => {});
		let elapsed = 0;
		for (const wait of row.retries) {
			(await socket()).drop();
			await clock.advance(wait);
			elapsed += wait;
		}
		await settle();
		expect(sockets).toHaveLength(row.retries.length + 1);

		await clock.advance(7999 - elapsed);
		expect(transport.connectionState).not.toBe('suspended');
		await clock.advance(1);

		expect(transport.connectionState).toBe('suspended');
		expect(transport.error).toBeInstanceOf(Error);
	});

	it('counts from the cut, clears on connect, and tells its listeners of each change', async () => {
		const { transport, clock, socket, letIn } = rig();
		const states: ConnectionState[] = [];
		transport.onChange(() => {
			if (states.at(-1) !== transport.connectionState) states.push(transport.connectionState);
		});
		transport.onMessage('a', 'note', () => {});
		await letIn();
		await clock.advance(1000);

		(await socket()).drop();
		await clock.advance(7999);
		expect(transport.connectionState).toBe('disconnected');
		await clock.advance(1);
		expect(transport.connectionState).toBe('suspended');
		await letIn();

		expect([transport.connectionState, transport.error]).toEqual(['connected', null]);
		expect(states).toEqual(['connecting', 'connected', 'disconnected', 'suspended', 'connected']);
	});

	it('does not show for a connection that came back within 8 s, then or later', async () => {
		const { transport, clock, socket, letIn } = rig();
		transport.onMessage('a', 'note', () => {});
		await letIn();
		(await socket()).drop();
		await clock.advance(250);
		await letIn();
		await clock.advance(8000);
		expect(transport.connectionState).toBe('connected');

		// A second cut is timed from itself, not from the first.
		(await socket()).drop();
		await clock.advance(7999);
		expect(transport.connectionState).toBe('disconnected');
	});
});

describe('an ask', () => {
	it.each([
		{ when: 'no ping of its own is waiting', waiting: false },
		{ when: 'its own ping is waiting for its pong', waiting: true },
	])('is answered at once with a ping, and with no timer, when $when', async ({ waiting }) => {
		const { transport, clock, letIn } = rig();
		transport.onMessage('a', 'note', () => {});
		const open = await letIn();
		if (waiting) await clock.advance(15_000);
		const before = { pings: open.pings, timers: clock.pending };

		open.hear({ t: 'ask' });

		// The clock has not moved. The ask is a frame heard, so it ends a wait for a
		// pong as any frame does; its answer starts none.
		expect(open.pings).toBe(before.pings + 1);
		expect(clock.pending).toBe(before.timers - (waiting ? 1 : 0));
	});
});

describe('the times', () => {
	it('are taken from the options', async () => {
		const { transport, clock, socket, letIn } = rig({
			connectTimeoutMs: 300,
			faultAfterMs: 500,
			heartbeatMs: 1000,
			pongTimeoutMs: 200,
		});
		transport.onMessage('a', 'note', () => {});
		const unopened = await socket();
		await clock.advance(299);
		expect(unopened.closed).toBeUndefined();
		await clock.advance(1);
		expect(unopened.closed).toBeDefined();

		await clock.advance(199);
		expect(transport.connectionState).toBe('disconnected');
		await clock.advance(1);
		expect(transport.connectionState).toBe('suspended');

		await clock.advance(50);
		const open = await letIn();
		await clock.advance(999);
		expect(open.pings).toBe(1);
		await clock.advance(1);
		expect(open.pings).toBe(2);

		await clock.advance(199);
		expect(transport.isConnected).toBe(true);
		await clock.advance(1);
		expect(transport.isConnected).toBe(false);
	});
});

describe('a socket a newer one of its own client replaced', () => {
	// Within the object's 5 s grace, so the place the late socket held for it is
	// still there: no watcher sees it leave and come back.
	it('is retried by itself after 2 s, as a cut and not as a refusal, then from the slow rhythm', async () => {
		const { transport, clock, sockets, socket, letIn } = rig();
		transport.onMessage('a', 'note', () => {});
		const first = await letIn();
		first.hear(attached('a', { seq: 3 }));

		first.drop(CLOSE_SUPERSEDED);

		expect([transport.connectionState, transport.refusal]).toEqual(['disconnected', null]);
		expect(transport.error).toBeInstanceOf(Error);
		await clock.advance(1999);
		expect(sockets).toHaveLength(1);
		await clock.advance(1);
		const second = await letIn();
		expect(second.frames[0]).toMatchObject({ t: 'hello', attach: [{ channel: 'a', since: 3 }] });
		expect(transport.connectionState).toBe('connected');

		// Replaced again as soon as it is back: the two change places once in 2 s, no faster.
		second.hear(attached('a', { resumed: true, seq: 3 }));
		second.drop(CLOSE_SUPERSEDED);
		await clock.advance(1999);
		expect(sockets).toHaveLength(2);
		await clock.advance(1);
		expect(sockets).toHaveLength(3);

		// A cut that follows goes on along the slow rhythm, past its 5 s step.
		(await socket()).drop();
		await clock.advance(9999);
		expect(sockets).toHaveLength(3);
		await clock.advance(1);
		expect(sockets).toHaveLength(4);
	});

	it('shows the fault once there has been no connection for 8 s, as any cut does', async () => {
		const { transport, clock, letIn } = rig();
		transport.onMessage('a', 'note', () => {});

		(await letIn()).drop(CLOSE_SUPERSEDED);
		await clock.advance(7999);
		expect(transport.connectionState).toBe('disconnected');
		await clock.advance(1);

		expect(transport.connectionState).toBe('suspended');
	});
});

describe('dispose', () => {
	it.each([
		{ when: 'connected' },
		{ when: 'waiting to retry' },
		{ when: 'waiting on an address' },
	] as const)('ends everything when $when', async (row) => {
		const { transport, clock, sockets, asks, socket, letIn } = rig(
			row.when === 'waiting on an address' ? { answer: never } : {},
		);
		const heard: unknown[] = [];
		transport.onMessage('a', 'note', (data) => heard.push(data));
		transport.watchPresence('a', (members) => heard.push(members));
		transport.enterPresence('a', { v: 1 });
		if (row.when === 'connected') (await letIn()).hear(attached('a'));
		if (row.when === 'waiting to retry') (await socket()).drop();
		await settle();
		const before = { asks: asks(), sockets: sockets.length };

		transport.dispose();

		expect(transport.connectionState).toBe('closed');
		expect(clock.pending).toBe(0);
		expect(sockets.filter((opened) => opened.readyState !== 3)).toEqual([]);
		// What a socket it has let go of says, and its close, come to nothing.
		for (const opened of sockets) {
			opened.hear(message('a', 1));
			opened.drop(1000);
		}
		transport.onMessage('b', 'note', () => {});
		transport.watchPresence('b', () => {});
		transport.enterPresence('b', { v: 1 });
		transport.checkNow();
		await clock.advance(120_000);
		expect({ asks: asks(), sockets: sockets.length }).toEqual(before);
		expect(heard).toEqual([]);
		expect(clock.pending).toBe(0);
	});
});

describe('a transport nothing is asked of any more', () => {
	it('closes its socket, shows no fault, and connects again for the next thing asked', async () => {
		const { transport, clock, sockets, letIn } = rig();
		const stop = transport.onMessage('a', 'note', () => {});
		const first = await letIn();
		first.hear(attached('a', { seq: 3 }));

		stop();

		expect(first.frames.at(-1)).toEqual({ t: 'detach', channel: 'a' });
		expect(first.closed).toEqual({ code: 1000 });
		expect(transport.connectionState).toBe('closed');
		expect(clock.pending).toBe(0);

		transport.onMessage('b', 'note', () => {});
		const second = await letIn();
		expect(sockets).toHaveLength(2);
		expect(second.frames[0]).toMatchObject({ t: 'hello', attach: [{ channel: 'b' }] });
	});

	it('stops retrying, and clears what it had to say of the outage', async () => {
		const { transport, clock, sockets, socket } = rig();
		const stop = transport.onMessage('a', 'note', () => {});
		const refusing = await socket();
		refusing.open();
		refusing.drop(CLOSE_REFUSED, 'not yours');

		stop();
		await clock.advance(120_000);

		expect(sockets).toHaveLength(1);
		expect([transport.connectionState, transport.error, transport.refusal]).toEqual([
			'closed',
			null,
			null,
		]);
	});
});
