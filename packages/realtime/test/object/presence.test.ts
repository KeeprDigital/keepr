import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CLOSE_STALE, CLOSE_SUPERSEDED } from '../../src/protocol.ts';
import { sleep } from './client.ts';
import type { TestClient } from './client.ts';
import { anyone, startServer } from './server.ts';
import type { Scope, Server } from './server.ts';
import { ASKED_SWEEP_MS, BRIEF_ASK_MS, BRIEF_GRACE_MS, BRIEF_SWEEP_MS } from './timings.ts';

let server: Server;
beforeAll(async () => {
	server = await startServer();
}, 60_000);
afterEach(() => server.closeSockets());
afterAll(() => server.close());

const ROOM = 'room';

/** A socket watching the room, told who is there. */
async function watcher(scope: Scope): Promise<TestClient> {
	const client = scope.connect();
	await client.hello({ watch: [ROOM] });
	return client;
}

/** A socket present in the room with `data`, and the connection id it is known by. */
async function member(
	scope: Scope,
	data: unknown,
	client?: string,
): Promise<{ socket: TestClient; connectionId: string }> {
	const socket = scope.connect(undefined, client === undefined ? {} : { client });
	await socket.hello({ attach: [{ channel: ROOM }], presence: { [ROOM]: data } });
	return { socket, connectionId: socket.attached(ROOM)?.connectionId as string };
}

/** Everything `from` did has reached `to`. */
async function settled(from: TestClient, to: TestClient): Promise<void> {
	await from.sync();
	await to.sync();
}

describe('presence', () => {
	it('tells a watcher of a member that enters, under its connection id', async () => {
		const scope = server.scope();
		const watching = await watcher(scope);
		const entering = scope.connect();
		await entering.hello({ attach: [{ channel: ROOM }] });

		entering.send({ t: 'enter', channel: ROOM, data: { name: 'first' } });
		await settled(entering, watching);

		expect(watching.presence(ROOM)).toEqual([
			{ t: 'presence', channel: ROOM, members: [] },
			{
				t: 'presence',
				channel: ROOM,
				members: [{ connectionId: entering.attached(ROOM)?.connectionId, data: { name: 'first' } }],
			},
		]);
	});

	it('tells a socket that starts to watch who is there, and one that stops nothing more', async () => {
		const scope = server.scope();
		const present = await member(scope, 1);
		const late = scope.connect();
		await late.opened;

		late.send({ t: 'watch', channel: ROOM });
		await late.sync();
		late.send({ t: 'unwatch', channel: ROOM });
		await late.sync();
		present.socket.send({ t: 'leave', channel: ROOM });
		await settled(present.socket, late);

		expect(late.presence(ROOM).map(({ members }) => members)).toEqual([
			[{ connectionId: present.connectionId, data: 1 }],
		]);
	});

	it('tells watchers of an update once, and not at all when nothing changed', async () => {
		const scope = server.scope();
		const watching = await watcher(scope);
		const present = await member(scope, { version: 1 });

		present.socket.send({ t: 'update', channel: ROOM, data: { version: 2 } });
		present.socket.send({ t: 'update', channel: ROOM, data: { version: 2 } });
		await settled(present.socket, watching);

		expect(watching.presence(ROOM).map(({ members }) => members)).toEqual([
			[],
			[{ connectionId: present.connectionId, data: { version: 1 } }],
			[{ connectionId: present.connectionId, data: { version: 2 } }],
		]);
	});

	it.each(['leave', 'detach'] as const)('tells watchers at once of a %s', async (how) => {
		const scope = server.scope();
		const watching = await watcher(scope);
		const [staying, going] = [await member(scope, 'stays'), await member(scope, 'goes')];

		going.socket.send({ t: how, channel: ROOM });
		await settled(going.socket, watching);

		expect(watching.members(ROOM)).toEqual([{ connectionId: staying.connectionId, data: 'stays' }]);
	});

	it('tells watchers at once when a socket that named no client closes', async () => {
		const scope = server.scope();
		const watching = await watcher(scope);
		const present = await member(scope, 1);
		await watching.sync();

		present.socket.close();
		await present.socket.closed;
		await watching.sync();

		// Told by the time its close was answered, not a grace period later.
		expect(watching.members(ROOM)).toEqual([]);
	});

	// A socket's attachment is 16 KiB at most, and its presence is in it.
	it.each(['enter', 'hello'] as const)(
		'refuses an %s with more than a socket can hold, and nobody is present',
		async (by) => {
			const scope = server.scope();
			const watching = await watcher(scope);
			const entering = scope.connect();
			const data = 'x'.repeat(20_000);

			if (by === 'enter') entering.send({ t: 'enter', channel: ROOM, data });
			else entering.send({ t: 'hello', attach: [{ channel: ROOM }], presence: { [ROOM]: data } });
			await settled(entering, watching);

			expect(entering.refusals()).toContainEqual({ t: 'refused', channel: ROOM, what: 'enter' });
			expect(entering.attached(ROOM)).toBeUndefined();
			expect(watching.members(ROOM)).toEqual([]);
		},
	);

	it("keeps a socket's channels, watches and presence through the object's sleep", async () => {
		const scope = server.scope();
		const watching = await watcher(scope);
		const present = await member(scope, { name: 'kept' });
		await watching.sync();

		await scope.hibernate();
		const [answer] = await scope.publish({ channel: ROOM, name: 'said', data: 1 });
		present.socket.send({ t: 'update', channel: ROOM, data: { name: 'changed' } });
		await settled(present.socket, watching);

		expect(answer?.recipients).toBe(1);
		expect(present.socket.messages(ROOM)).toHaveLength(1);
		expect(watching.members(ROOM)).toEqual([
			{ connectionId: present.connectionId, data: { name: 'changed' } },
		]);
	});
});

describe('a client that connects again', () => {
	it('replaces its earlier socket and keeps its place, with no watcher told', async () => {
		const scope = server.scope();
		const watching = await watcher(scope);
		const earlier = await member(scope, { name: 'same' }, 'client-1');
		await watching.sync();
		const told = watching.presence(ROOM).length;

		const again = await member(scope, { name: 'same' }, 'client-1');
		await settled(again.socket, watching);

		expect(await earlier.socket.closed).toMatchObject({ code: CLOSE_SUPERSEDED });
		expect(again.connectionId).toBe(earlier.connectionId);
		expect(watching.presence(ROOM)).toHaveLength(told);

		// Whoever is told next sees one member where the earlier socket stood.
		const other = await member(scope, 'other');
		await settled(other.socket, watching);
		expect(watching.members(ROOM)).toEqual(
			expect.arrayContaining([
				{ connectionId: earlier.connectionId, data: { name: 'same' } },
				{ connectionId: other.connectionId, data: 'other' },
			]),
		);
		expect(watching.members(ROOM)).toHaveLength(2);
	});

	it('gives up the place its hello does not ask for again', async () => {
		const scope = server.scope();
		const watching = await watcher(scope);
		await member(scope, 1, 'client-1');

		const again = scope.connect(undefined, { client: 'client-1' });
		await again.hello({ attach: [{ channel: ROOM }] });
		await watching.sync();

		expect(watching.members(ROOM)).toEqual([]);
	});

	it('does not replace the socket of a client with another id', async () => {
		const scope = server.scope();
		const watching = await watcher(scope);
		const one = await member(scope, 1, 'client-1');

		const two = await member(scope, 2, 'client-2');
		await settled(two.socket, watching);
		await one.socket.sync();

		expect(one.socket.isClosed()).toBe(false);
		expect(watching.members(ROOM)).toHaveLength(2);
	});
});

describe('a member whose socket closes', () => {
	it('is held for the grace period, and watchers are told only when it ends', async () => {
		const scope = server.scope('BRIEF_GRACE');
		const watching = await watcher(scope);
		const present = await member(scope, 1, 'client-1');
		await watching.sync();

		// Measured from before the close, so a slow machine can only lengthen it.
		const closing = Date.now();
		present.socket.close();
		await watching.waitFor(
			'the member to go',
			() => watching.members(ROOM)?.length === 0,
			BRIEF_GRACE_MS * 4,
		);

		expect(Date.now() - closing).toBeGreaterThanOrEqual(BRIEF_GRACE_MS);
	}, 15_000);

	it('keeps its place when its client returns within the grace period, with no watcher told', async () => {
		const scope = server.scope('BRIEF_GRACE');
		const watching = await watcher(scope);
		const earlier = await member(scope, { name: 'same' }, 'client-1');
		await watching.sync();
		const told = watching.presence(ROOM).length;

		earlier.socket.close();
		await earlier.socket.closed;
		const again = await member(scope, { name: 'same' }, 'client-1');
		await sleep(BRIEF_GRACE_MS + 300);
		await settled(again.socket, watching);

		expect(again.connectionId).toBe(earlier.connectionId);
		expect(watching.presence(ROOM)).toHaveLength(told);
		// And it is still there for whoever asks.
		const late = await watcher(scope);
		expect(late.members(ROOM)).toEqual([
			{ connectionId: earlier.connectionId, data: { name: 'same' } },
		]);
	}, 15_000);
});

// A restart closes every socket of the scope at once, and no close reaches the object.
describe('a member whose object restarts', () => {
	it('is there for a watcher that returns first, and keeps its place when its client returns', async () => {
		const scope = server.scope();
		const before = await watcher(scope);
		const earlier = await member(scope, { name: 'same' }, 'client-1');
		const unnamed = await member(scope, 'cannot return');
		await before.sync();

		await scope.restart();
		await Promise.all([before.closed, earlier.socket.closed, unnamed.socket.closed]);
		const watching = await watcher(scope);
		const again = await member(scope, { name: 'same' }, 'client-1');
		await settled(again.socket, watching);

		// One frame, on watching: the member that named a client, never seen to leave.
		expect(watching.presence(ROOM).map(({ members }) => members)).toEqual([
			[{ connectionId: earlier.connectionId, data: { name: 'same' } }],
		]);
		expect(again.connectionId).toBe(earlier.connectionId);
	});

	it('is told of after the grace period when its client does not return', async () => {
		const scope = server.scope('BRIEF_GRACE');
		await member(scope, 1, 'client-1');

		// Measured from before the restart, so a slow machine can only lengthen it.
		const restarting = Date.now();
		await scope.restart();
		const watching = await watcher(scope);
		const held = watching.members(ROOM);
		await watching.waitFor(
			'the member to go',
			() => watching.members(ROOM)?.length === 0,
			BRIEF_GRACE_MS * 4,
		);

		expect(held).toHaveLength(1);
		expect(Date.now() - restarting).toBeGreaterThanOrEqual(BRIEF_GRACE_MS);
	}, 15_000);

	it('is dropped at once by a disconnect of its tag', async () => {
		const scope = server.scope();
		const present = scope.connect({ ...anyone, tags: ['key:1'] }, { client: 'client-1' });
		await present.hello({ presence: { [ROOM]: 1 } });

		await scope.restart();
		const watching = await watcher(scope);
		const held = watching.members(ROOM);
		await scope.disconnect('key:1');
		await watching.sync();

		expect(held).toHaveLength(1);
		expect(watching.members(ROOM)).toEqual([]);
	});

	it('is held with what it last had: an update is kept', async () => {
		const scope = server.scope();
		const present = await member(scope, { version: 1 }, 'client-1');
		present.socket.send({ t: 'update', channel: ROOM, data: { version: 2 } });
		await present.socket.sync();

		await scope.restart();
		const watching = await watcher(scope);

		expect(watching.members(ROOM)).toEqual([
			{ connectionId: present.connectionId, data: { version: 2 } },
		]);
	});

	// Whoever was told of as gone before the restart is not brought back by it.
	it.each([
		{
			how: 'left',
			binding: 'DEFAULTS' as const,
			go: async (socket: TestClient) => {
				socket.send({ t: 'leave', channel: ROOM });
				await socket.sync();
			},
		},
		{
			how: 'was disconnected',
			binding: 'DEFAULTS' as const,
			go: async (socket: TestClient, scope: Scope) => {
				await scope.disconnect('key:1');
				await socket.closed;
			},
		},
		{
			how: 'was swept',
			binding: 'BRIEF_SWEEP' as const,
			go: async (socket: TestClient) => {
				await socket.closed;
			},
		},
		{
			how: 'gave up its place on connecting again',
			binding: 'DEFAULTS' as const,
			go: async (_socket: TestClient, scope: Scope) => {
				const again = scope.connect({ ...anyone, tags: ['key:1'] }, { client: 'client-1' });
				await again.hello();
			},
		},
	])(
		'is not held when it $how before the restart',
		async ({ binding, go }) => {
			const scope = server.scope(binding);
			const present = scope.connect({ ...anyone, tags: ['key:1'] }, { client: 'client-1' });
			await present.hello({ presence: { [ROOM]: 1 } });
			await go(present, scope);

			await scope.restart();
			const watching = await watcher(scope);

			expect(watching.members(ROOM)).toEqual([]);
		},
		15_000,
	);
});

describe('a member whose object sleeps', () => {
	it('is neither held nor dropped: it is counted once, and no watcher is told', async () => {
		const scope = server.scope('BRIEF_GRACE');
		const watching = await watcher(scope);
		const present = await member(scope, 1, 'client-1');
		await watching.sync();
		const told = watching.presence(ROOM).length;

		await scope.hibernate();
		const late = await watcher(scope);
		await sleep(BRIEF_GRACE_MS + 300);
		await settled(present.socket, watching);

		expect(late.members(ROOM)).toEqual([{ connectionId: present.connectionId, data: 1 }]);
		expect(watching.presence(ROOM)).toHaveLength(told);
		expect(present.socket.isClosed()).toBe(false);
	}, 15_000);
});

describe('a member whose pings stop', () => {
	it('is swept at the limit and its socket closed, while one that pings stays', async () => {
		const scope = server.scope('BRIEF_SWEEP');
		const watching = await watcher(scope);
		const [alive, silent] = [await member(scope, 'alive'), await member(scope, 'silent')];
		const pinging = setInterval(() => void alive.socket.ping().catch(() => {}), BRIEF_SWEEP_MS / 5);
		try {
			await watching.waitFor(
				'the silent member to be swept',
				() => watching.members(ROOM)?.length === 1,
				BRIEF_SWEEP_MS * 4,
			);
			expect(await silent.socket.closed).toMatchObject({ code: CLOSE_STALE });

			await sleep(BRIEF_SWEEP_MS * 1.2);
			await watching.sync();
			expect(watching.members(ROOM)).toEqual([{ connectionId: alive.connectionId, data: 'alive' }]);
			expect(alive.socket.isClosed()).toBe(false);
		} finally {
			clearInterval(pinging);
		}
	}, 20_000);

	it('is asked first, and keeps its place by answering, with no watcher told', async () => {
		const scope = server.scope('BRIEF_ASK');
		const watching = await watcher(scope);
		const present = await member(scope, 1);
		present.socket.answerAsks();
		await watching.sync();
		const told = watching.presence(ROOM).length;

		// It pings only in answer, and is still there well past the limit.
		await sleep(ASKED_SWEEP_MS * 1.5);
		await settled(present.socket, watching);

		expect(present.socket.asks()).toBeGreaterThan(0);
		expect(present.socket.isClosed()).toBe(false);
		expect(watching.presence(ROOM)).toHaveLength(told);
		// And it is still there for whoever asks.
		const late = await watcher(scope);
		expect(late.members(ROOM)).toEqual([{ connectionId: present.connectionId, data: 1 }]);
	}, 15_000);

	it('is asked once, and swept at the limit when it does not answer', async () => {
		const scope = server.scope('BRIEF_ASK');
		const watching = await watcher(scope);
		// Measured from before it connects, so a slow machine can only lengthen it.
		const connecting = Date.now();
		const first = await member(scope, 'first');
		// The second's ask is an alarm between the first's ask and its sweep, and the
		// first's sweep is one between the second's. Neither asks again.
		await sleep(BRIEF_ASK_MS / 2);
		const second = await member(scope, 'second');

		expect(await first.socket.closed).toMatchObject({ code: CLOSE_STALE });
		expect(Date.now() - connecting).toBeGreaterThanOrEqual(ASKED_SWEEP_MS);
		expect(await second.socket.closed).toMatchObject({ code: CLOSE_STALE });
		await watching.sync();
		expect([first.socket.asks(), second.socket.asks()]).toEqual([1, 1]);
		expect(watching.members(ROOM)).toEqual([]);
	}, 15_000);

	it('is asked at two thirds of the limit by an object that states only its sweep', async () => {
		const scope = server.scope('BRIEF_SWEEP');
		// Measured from before it connects, so a slow machine can only lengthen it.
		const connecting = Date.now();
		const silent = await member(scope, 1);

		// The ask reaches it before its close does, or the wait fails on the close.
		await silent.socket.waitFor('the ask', () => silent.socket.asks() > 0, BRIEF_SWEEP_MS * 4);

		expect(Date.now() - connecting).toBeGreaterThanOrEqual((BRIEF_SWEEP_MS * 2) / 3);
	}, 15_000);

	it('is looked for when its ask is due, and once asked, at its limit', async () => {
		const scope = server.scope('BRIEF_ASK');
		// It was accepted between these two, and nothing is heard from it after.
		const connecting = Date.now();
		const silent = await member(scope, 1);
		const connected = Date.now();

		const unasked = await scope.call<number>('alarmAt');
		await silent.socket.waitFor('the ask', () => silent.socket.asks() > 0, ASKED_SWEEP_MS);
		const asked = await scope.call<number>('alarmAt');

		expect(unasked).toBeGreaterThanOrEqual(connecting + BRIEF_ASK_MS);
		expect(unasked).toBeLessThanOrEqual(connected + BRIEF_ASK_MS);
		expect(asked).toBeGreaterThanOrEqual(connecting + ASKED_SWEEP_MS);
		expect(asked).toBeLessThanOrEqual(connected + ASKED_SWEEP_MS);
	}, 15_000);

	it('is looked for only while anyone is present', async () => {
		const scope = server.scope('BRIEF_SWEEP');
		const hearing = scope.connect();
		await hearing.hello({ attach: [{ channel: ROOM }], watch: [ROOM] });
		const before = await scope.call<number | null>('alarmAt');

		const present = await member(scope, 1);
		const during = await scope.call<number | null>('alarmAt');
		present.socket.send({ t: 'leave', channel: ROOM });
		await present.socket.sync();

		expect([before, during]).toEqual([null, expect.any(Number)]);
		// The alarm already set runs once more, finds nobody, and sets no other.
		await expect
			.poll(() => scope.call<number | null>('alarmAt'), { timeout: BRIEF_SWEEP_MS * 6 })
			.toBeNull();
	}, 15_000);
});
