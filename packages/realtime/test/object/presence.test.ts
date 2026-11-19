import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CLOSE_STALE, CLOSE_SUPERSEDED } from '../../src/protocol.ts';
import { sleep } from './client.ts';
import type { TestClient } from './client.ts';
import { startServer } from './server.ts';
import type { Scope, Server } from './server.ts';
import { BRIEF_GRACE_MS, BRIEF_SWEEP_MS } from './timings.ts';

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
