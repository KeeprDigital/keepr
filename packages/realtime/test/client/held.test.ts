import { describe, expect, it } from 'vitest';

import type { SocketTransport } from '../../src/client/index.ts';
import type { ClientFrame, HelloFrame, PresenceMember } from '../../src/protocol.ts';
import { attached, presence, refused, rig, settle } from './helpers/rig.ts';
import type { FakeSocket } from './helpers/rig.ts';

const heldA = { channel: 'a', since: 3 };

/** A transport that heard `a` up to sequence 3 and then lost its connection. */
async function cut(before?: (transport: SocketTransport) => void) {
	const held = rig();
	held.transport.onMessage('a', 'note', () => {});
	before?.(held.transport);
	const first = await held.letIn();
	first.hear(attached('a', { seq: 3 }));
	first.drop();
	return held;
}

describe('what is asked for while the connection is down', () => {
	it.each<{
		kept: string;
		before?: (transport: SocketTransport) => void;
		ask: (transport: SocketTransport) => void;
		hello: Partial<HelloFrame>;
	}>([
		{
			kept: 'a subscription',
			ask: (transport) => transport.onMessage('b', 'note', () => {}),
			hello: { attach: [heldA, { channel: 'b' }], watch: [], presence: {} },
		},
		{
			kept: 'a continuity-lost listener',
			ask: (transport) => transport.onContinuityLost('b', () => {}),
			hello: { attach: [heldA, { channel: 'b' }], watch: [], presence: {} },
		},
		{
			kept: 'a presence watch',
			ask: (transport) => transport.watchPresence('b', () => {}),
			hello: { attach: [heldA], watch: ['b'], presence: {} },
		},
		{
			kept: 'a presence entry',
			ask: (transport) => transport.enterPresence('b', { version: 1 }),
			hello: { attach: [heldA, { channel: 'b' }], watch: [], presence: { b: { version: 1 } } },
		},
		{
			kept: 'the update to a presence entry made before the cut',
			before: (transport) => transport.enterPresence('a', { version: 1 }),
			ask: (transport) => transport.updatePresence('a', { version: 2 }),
			hello: { attach: [heldA], watch: [], presence: { a: { version: 2 } } },
		},
		{
			kept: 'the update to a presence entry made after it',
			ask: (transport) => {
				transport.enterPresence('b', { version: 1 });
				transport.updatePresence('b', { version: 2 });
			},
			hello: { attach: [heldA, { channel: 'b' }], watch: [], presence: { b: { version: 2 } } },
		},
	])('keeps $kept, and sends it once as the socket opens', async (row) => {
		const { transport, clock, socket } = await cut(row.before);

		row.ask(transport);
		await clock.advance(250);
		const next = await socket();
		next.open();

		expect(next.frames).toEqual([{ t: 'hello', epoch: 'epoch-1', ...row.hello }]);
	});

	it.each<{ ended: string; ask: (transport: SocketTransport) => () => void }>([
		{ ended: 'a subscription', ask: (transport) => transport.onMessage('b', 'note', () => {}) },
		{ ended: 'a presence watch', ask: (transport) => transport.watchPresence('b', () => {}) },
		{
			ended: 'a presence entry',
			ask: (transport) => {
				transport.enterPresence('b', { version: 1 });
				return () => transport.leavePresence('b');
			},
		},
	])('forgets $ended only when its consumer ends it', async (row) => {
		const { transport, clock, socket } = await cut();

		row.ask(transport)();
		await clock.advance(250);
		const next = await socket();
		next.open();

		expect(next.frames).toEqual([
			{ t: 'hello', epoch: 'epoch-1', attach: [heldA], watch: [], presence: {} },
		]);
	});

	it('tells a channel first asked for while down of a loss when it attaches', async () => {
		const { transport, clock, letIn } = await cut();
		let lost = 0;

		transport.onContinuityLost('b', () => {
			lost += 1;
		});
		await clock.advance(250);
		(await letIn()).hear(attached('b'));

		expect(lost).toBe(1);
	});
});

describe('what is asked for on an open socket', () => {
	it.each<{ asked: string; ask: (transport: SocketTransport) => void; frames: ClientFrame[] }>([
		{
			asked: 'a subscription to a new channel',
			ask: (transport) => transport.onMessage('b', 'note', () => {}),
			frames: [{ t: 'attach', channel: 'b', epoch: 'epoch-1' }],
		},
		{
			asked: 'its disposal',
			ask: (transport) => transport.onMessage('b', 'note', () => {})(),
			frames: [
				{ t: 'attach', channel: 'b', epoch: 'epoch-1' },
				{ t: 'detach', channel: 'b' },
			],
		},
		{
			asked: 'a second handler on a channel it holds, and the disposal of one of the two',
			ask: (transport) => transport.onMessage('a', 'other', () => {})(),
			frames: [],
		},
		{
			asked: 'a presence watch, twice',
			ask: (transport) => {
				transport.watchPresence('b', () => {});
				transport.watchPresence('b', () => {});
			},
			frames: [{ t: 'watch', channel: 'b' }],
		},
		{
			asked: 'the disposal of one of two presence watches',
			ask: (transport) => {
				transport.watchPresence('b', () => {});
				transport.watchPresence('b', () => {})();
			},
			frames: [{ t: 'watch', channel: 'b' }],
		},
		{
			asked: 'the disposal of the last presence watch',
			ask: (transport) => transport.watchPresence('b', () => {})(),
			frames: [
				{ t: 'watch', channel: 'b' },
				{ t: 'unwatch', channel: 'b' },
			],
		},
		{
			asked: 'a presence entry on a new channel',
			ask: (transport) => transport.enterPresence('b', { version: 1 }),
			frames: [
				{ t: 'attach', channel: 'b', epoch: 'epoch-1' },
				{ t: 'enter', channel: 'b', data: { version: 1 } },
			],
		},
		{
			asked: 'a presence entry on a channel it holds, then updated',
			ask: (transport) => {
				transport.enterPresence('a', { version: 1 });
				transport.updatePresence('a', { version: 2 });
			},
			frames: [
				{ t: 'enter', channel: 'a', data: { version: 1 } },
				{ t: 'update', channel: 'a', data: { version: 2 } },
			],
		},
		{
			asked: 'the disposal of the only handler on a channel it has entered',
			ask: (transport) => {
				const stop = transport.onMessage('b', 'note', () => {});
				transport.enterPresence('b', { version: 1 });
				stop();
			},
			frames: [
				{ t: 'attach', channel: 'b', epoch: 'epoch-1' },
				{ t: 'enter', channel: 'b', data: { version: 1 } },
			],
		},
		{
			asked: 'an update to a presence entry never made',
			ask: (transport) => transport.updatePresence('a', { version: 2 }),
			frames: [],
		},
		{
			asked: 'a presence entry left, on a channel it holds for another reason',
			ask: (transport) => {
				transport.enterPresence('a', { version: 1 });
				transport.leavePresence('a');
			},
			frames: [
				{ t: 'enter', channel: 'a', data: { version: 1 } },
				{ t: 'leave', channel: 'a' },
			],
		},
		{
			asked: 'a presence entry left, on a channel held only for it',
			ask: (transport) => {
				transport.enterPresence('b', { version: 1 });
				transport.leavePresence('b');
			},
			frames: [
				{ t: 'attach', channel: 'b', epoch: 'epoch-1' },
				{ t: 'enter', channel: 'b', data: { version: 1 } },
				{ t: 'leave', channel: 'b' },
				{ t: 'detach', channel: 'b' },
			],
		},
	])('sends $asked as its own frames', async (row) => {
		const { transport, letIn } = rig();
		transport.onMessage('a', 'note', () => {});
		const open = await letIn();
		open.hear(attached('a'));
		const sentBefore = open.frames.length;

		row.ask(transport);

		expect(open.frames.slice(sentBefore)).toEqual(row.frames);
	});
});

describe('a presence watch', () => {
	it('is told the members of its channel, whole, each time they come', async () => {
		const { transport, letIn } = rig();
		const seen: PresenceMember[][] = [];
		const elsewhere: PresenceMember[][] = [];
		transport.watchPresence('a', (members) => seen.push(members));
		transport.watchPresence('b', (members) => elsewhere.push(members));
		const open = await letIn();

		open.hear(presence('a', [{ connectionId: 'one', data: { version: 1 } }]));
		open.hear(presence('a', []));

		expect(seen).toEqual([[{ connectionId: 'one', data: { version: 1 } }], []]);
		expect(elsewhere).toEqual([]);
	});

	// What was last heard is stale once the socket that heard it is gone or refused.
	it.each([
		{ after: 'a cut', end: (open: FakeSocket) => open.drop() },
		{ after: 'a refused watch', end: (open: FakeSocket) => open.hear(refused('a', 'watch')) },
	])('gives a later watcher nothing after $after', async (row) => {
		const { transport, letIn } = rig();
		transport.watchPresence('a', () => {});
		const open = await letIn();
		open.hear(presence('a', [{ connectionId: 'one' }]));
		row.end(open);
		const seen: PresenceMember[][] = [];

		transport.watchPresence('a', (members) => seen.push(members));
		await settle();

		expect(seen).toEqual([]);
	});

	it.each([
		{ watcher: 'still watching', stops: false, told: 1 },
		{ watcher: 'gone before it could be told', stops: true, told: 0 },
	])('gives a later watcher of the same channel, $watcher, the members last heard', async (row) => {
		const { transport, letIn } = rig();
		transport.watchPresence('a', () => {});
		const open = await letIn();
		open.hear(presence('a', [{ connectionId: 'one' }]));
		const seen: PresenceMember[][] = [];

		const stop = transport.watchPresence('a', (members) => seen.push(members));
		if (row.stops) stop();
		await settle();

		expect(seen).toHaveLength(row.told);
		expect(open.frames.filter((frame) => frame.t === 'watch')).toHaveLength(0);
	});
});
