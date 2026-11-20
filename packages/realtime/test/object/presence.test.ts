import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_GRACE_MS, DEFAULT_MAX_AGE_MS, DEFAULT_SWEEP_MS } from '../../src/object/limits.ts';
import { CLOSE_EXPIRED, CLOSE_STALE, CLOSE_SUPERSEDED } from '../../src/protocol.ts';
import type { TestClient } from './client.ts';
import { anyone, startServer } from './server.ts';
import type { Scope, Server } from './server.ts';

let server: Server;
beforeAll(async () => {
	server = await startServer();
}, 60_000);
afterEach(() => server.closeSockets());
afterAll(() => server.close());

const ROOM = 'room';
/** When the object asks a silent socket at its defaults: two thirds of the sweep. */
const ASK_MS = (DEFAULT_SWEEP_MS * 2) / 3;

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
	// An enter keeps what the socket held; a hello that cannot be held holds nothing.
	it.each([
		{ by: 'enter', attached: true },
		{ by: 'hello', attached: false },
	] as const)(
		'refuses an $by with more than a socket can hold, nobody is present, and its attach stands: $attached',
		async ({ by, attached }) => {
			const scope = server.scope();
			const watching = await watcher(scope);
			const entering = scope.connect();
			await entering.hello({ attach: [{ channel: ROOM }] });
			const data = 'x'.repeat(20_000);

			if (by === 'enter') entering.send({ t: 'enter', channel: ROOM, data });
			else entering.send({ t: 'hello', attach: [{ channel: ROOM }], presence: { [ROOM]: data } });
			await settled(entering, watching);
			const [answer] = await scope.publish({ channel: ROOM, name: 'said', data: 1 });

			expect(entering.refusals()).toContainEqual({ t: 'refused', channel: ROOM, what: 'enter' });
			expect(answer?.recipients).toBe(attached ? 1 : 0);
			expect(watching.members(ROOM)).toEqual([]);
		},
	);

	// A socket that holds nearly all it can is refused one more channel.
	it.each(['attach', 'watch'] as const)(
		'refuses an %s past what a socket can hold, and keeps what it held',
		async (what) => {
			const scope = server.scope();
			const full = scope.connect();
			await full.hello({ attach: [{ channel: ROOM }], presence: { [ROOM]: 'x'.repeat(15_000) } });
			const long = 'c'.repeat(2000);

			full.send({ t: what, channel: long });
			await full.sync();
			const [answer] = await scope.publish({ channel: ROOM, name: 'said', data: 1 });
			await full.sync();

			expect(full.refusals()).toEqual([{ t: 'refused', channel: long, what }]);
			expect(answer?.recipients).toBe(1);
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

	it('gives up a place it can no longer hold beside its new grant, and watchers are told at once', async () => {
		const scope = server.scope();
		const watching = await watcher(scope);
		const earlier = await member(scope, 'x'.repeat(13_000), 'client-1');
		await watching.sync();

		const wider = { ...anyone, hear: ['*', 'h'.repeat(4000)] };
		const again = scope.connect(wider, { client: 'client-1' });
		await again.opened;
		await again.sync();
		await watching.sync();

		expect(await earlier.socket.closed).toMatchObject({ code: CLOSE_SUPERSEDED });
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
		const scope = server.scope();
		const watching = await watcher(scope);
		const present = await member(scope, 1, 'client-1');
		await watching.sync();

		present.socket.close();
		await present.socket.closed;
		await scope.advance(0);
		await watching.sync();
		const held = watching.members(ROOM);
		await scope.advance(DEFAULT_GRACE_MS);
		await watching.sync();

		expect(held).toHaveLength(1);
		expect(watching.members(ROOM)).toEqual([]);
	});

	it('keeps its place when its client returns within the grace period, with no watcher told', async () => {
		const scope = server.scope();
		const watching = await watcher(scope);
		const earlier = await member(scope, { name: 'same' }, 'client-1');
		await watching.sync();
		const told = watching.presence(ROOM).length;

		earlier.socket.close();
		await earlier.socket.closed;
		const again = await member(scope, { name: 'same' }, 'client-1');
		await scope.advance(DEFAULT_GRACE_MS);
		await settled(again.socket, watching);

		expect(again.connectionId).toBe(earlier.connectionId);
		expect(watching.presence(ROOM)).toHaveLength(told);
		// And it is still there for whoever asks.
		const late = await watcher(scope);
		expect(late.members(ROOM)).toEqual([
			{ connectionId: earlier.connectionId, data: { name: 'same' } },
		]);
	});
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
		const scope = server.scope();
		await member(scope, 1, 'client-1');

		await scope.restart();
		const watching = await watcher(scope);
		const held = watching.members(ROOM);
		await scope.advance(DEFAULT_GRACE_MS);
		await watching.sync();

		expect(held).toHaveLength(1);
		expect(watching.members(ROOM)).toEqual([]);
	});

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
			go: async (socket: TestClient) => {
				socket.send({ t: 'leave', channel: ROOM });
				await socket.sync();
			},
		},
		{
			how: 'was disconnected',
			go: async (socket: TestClient, scope: Scope) => {
				await scope.disconnect('key:1');
				await socket.closed;
			},
		},
		{
			how: 'was swept',
			go: async (socket: TestClient, scope: Scope) => {
				await scope.advance(DEFAULT_SWEEP_MS);
				await socket.closed;
			},
		},
		{
			how: 'gave up its place on connecting again',
			go: async (_socket: TestClient, scope: Scope) => {
				const again = scope.connect({ ...anyone, tags: ['key:1'] }, { client: 'client-1' });
				await again.hello();
			},
		},
	])('is not held when it $how before the restart', async ({ go }) => {
		const scope = server.scope();
		const present = scope.connect({ ...anyone, tags: ['key:1'] }, { client: 'client-1' });
		await present.hello({ presence: { [ROOM]: 1 } });
		await go(present, scope);

		await scope.restart();
		const watching = await watcher(scope);

		expect(watching.members(ROOM)).toEqual([]);
	});
});

describe('a member whose object sleeps', () => {
	it('is neither held nor dropped: it is counted once, and no watcher is told', async () => {
		const scope = server.scope();
		const watching = await watcher(scope);
		const present = await member(scope, 1, 'client-1');
		await watching.sync();
		const told = watching.presence(ROOM).length;

		await scope.hibernate();
		const late = await watcher(scope);
		await scope.advance(DEFAULT_GRACE_MS);
		await settled(present.socket, watching);

		expect(late.members(ROOM)).toEqual([{ connectionId: present.connectionId, data: 1 }]);
		expect(watching.presence(ROOM)).toHaveLength(told);
		expect(present.socket.isClosed()).toBe(false);
	});
});

describe('a socket whose pings stop', () => {
	it('is swept at the limit and its socket closed, while one that pings stays', async () => {
		const scope = server.scope();
		const watching = await watcher(scope);
		const [alive, silent] = [await member(scope, 'alive'), await member(scope, 'silent')];

		await scope.advance(ASK_MS);
		await Promise.all([alive.socket.ping(), watching.ping()]);
		await scope.advance(DEFAULT_SWEEP_MS - ASK_MS);
		await watching.sync();

		expect(await silent.socket.closed).toMatchObject({ code: CLOSE_STALE });
		expect(watching.members(ROOM)).toEqual([{ connectionId: alive.connectionId, data: 'alive' }]);
		expect(alive.socket.isClosed()).toBe(false);
	});

	// Swept as a member is, though it holds no place: a vanished peer costs its
	// socket and the frames sent it.
	it('that holds no presence is no recipient past the limit, and is swept', async () => {
		const scope = server.scope();
		const hearing = scope.connect();
		await hearing.hello({ attach: [{ channel: ROOM }] });

		await scope.advance(DEFAULT_SWEEP_MS, { alarm: false });
		const [answer] = await scope.publish({ channel: ROOM, name: 'said', data: 1 });
		await scope.advance(0);

		expect(answer?.recipients).toBe(0);
		expect(await hearing.closed).toMatchObject({ code: CLOSE_STALE });
		expect(hearing.messages(ROOM)).toEqual([]);
	});

	it('is asked first, and keeps its place by answering, with no watcher told', async () => {
		const scope = server.scope();
		const watching = await watcher(scope);
		watching.answerAsks();
		const present = await member(scope, 1);
		present.socket.answerAsks();
		await watching.sync();
		const told = watching.presence(ROOM).length;

		// It pings only in answer, and is still there past the limit.
		await scope.advance(ASK_MS);
		await present.socket.waitFor('the ask', () => present.socket.asks() > 0);
		await Promise.all([present.socket.answered(), watching.answered()]);
		await scope.advance(DEFAULT_SWEEP_MS - ASK_MS);
		await settled(present.socket, watching);

		expect(present.socket.isClosed()).toBe(false);
		expect(watching.presence(ROOM)).toHaveLength(told);
		// And it is still there for whoever asks.
		const late = await watcher(scope);
		expect(late.members(ROOM)).toEqual([{ connectionId: present.connectionId, data: 1 }]);
	});

	it('is asked once for its silence, and swept at the limit when it does not answer', async () => {
		const scope = server.scope();
		const silent = await member(scope, 'silent');

		await scope.advance(ASK_MS);
		// An alarm that runs again within the silence asks nothing more.
		await scope.advance(1);
		await scope.advance(DEFAULT_SWEEP_MS - ASK_MS);

		expect(await silent.socket.closed).toMatchObject({ code: CLOSE_STALE });
		expect(silent.socket.asks()).toBe(1);
	});

	// Two thirds of the limit, from when it was accepted.
	it.each([
		{ after: ASK_MS - 5000, asked: 0 },
		{ after: ASK_MS, asked: 1 },
	])('is asked $asked time(s) $after ms into its silence', async ({ after, asked }) => {
		const scope = server.scope();
		const silent = await member(scope, 1);

		await scope.advance(after);
		await silent.socket.sync();

		expect(silent.socket.asks()).toBe(asked);
	});

	it('is looked for when its ask is due, and once asked, at its limit', async () => {
		const scope = server.scope();
		// It was accepted between these two, and nothing is heard from it after.
		const connecting = Date.now();
		await member(scope, 1);
		const connected = Date.now();

		const unasked = await scope.call<number>('alarmAt');
		await scope.advance(ASK_MS);
		const asked = await scope.call<number>('alarmAt');

		expect(unasked).toBeGreaterThanOrEqual(connecting + ASK_MS);
		expect(unasked).toBeLessThanOrEqual(connected + ASK_MS);
		expect(asked).toBeGreaterThanOrEqual(connecting + DEFAULT_SWEEP_MS);
		expect(asked).toBeLessThanOrEqual(connected + DEFAULT_SWEEP_MS);
	});

	it('is looked for while any socket is open, and nothing is once none is', async () => {
		const scope = server.scope();
		const hearing = scope.connect();
		await hearing.hello({ watch: [ROOM] });
		const during = await scope.call<number | null>('alarmAt');

		hearing.close();
		await hearing.closed;
		await scope.advance(0);

		expect(during).toEqual(expect.any(Number));
		expect(await scope.call('alarmAt')).toBeNull();
	});
});

describe('a socket past its age', () => {
	it('is closed as expired, and its member held for its client to return', async () => {
		const scope = server.scope();
		const present = await member(scope, 1, 'client-1');

		await scope.advance(DEFAULT_MAX_AGE_MS);
		const closed = await present.socket.closed;
		const watching = await watcher(scope);

		expect(closed).toMatchObject({ code: CLOSE_EXPIRED });
		expect(watching.members(ROOM)).toEqual([{ connectionId: present.connectionId, data: 1 }]);
	});
});
