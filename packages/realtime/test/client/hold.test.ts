import { describe, expect, it } from 'vitest';

import { PONG } from '../../src/protocol.ts';
import { attached, rig } from './helpers/rig.ts';

describe('a held transport', () => {
	it('keeps its socket and its heartbeat with nothing asked, and asks the next thing on it', async () => {
		const { transport, clock, sockets, asks, letIn } = rig();
		transport.hold();
		const stop = transport.onMessage('a', 'note', () => {});
		const open = await letIn();
		open.hear(attached('a', { seq: 3 }));

		stop();

		expect(open.frames.at(-1)).toEqual({ t: 'detach', channel: 'a' });
		expect(open.closed).toBeUndefined();
		expect(transport.connectionState).toBe('connected');
		await clock.advance(15_000);
		expect(open.pings).toBe(2);
		open.hear(PONG);

		// The channel was forgotten with its last handler: a first attach, on the socket kept.
		transport.onMessage('a', 'note', () => {});
		expect(open.frames.at(-1)).toEqual({ t: 'attach', channel: 'a', epoch: 'epoch-1' });
		expect([asks(), sockets.length]).toEqual([1, 1]);
	});

	it('connects for the hold alone, and asks the object for nothing', async () => {
		const { transport, asks, letIn } = rig();

		transport.hold();
		const open = await letIn();

		expect(asks()).toBe(1);
		expect(open.frames).toEqual([{ t: 'hello', attach: [], watch: [], presence: {} }]);
		expect(transport.connectionState).toBe('connected');
	});

	it('that loses its socket with nothing asked is retried, shows the fault after 8 s, and comes back', async () => {
		const { transport, clock, sockets, letIn } = rig();
		transport.hold();
		(await letIn()).drop();

		await clock.advance(249);
		expect(sockets).toHaveLength(1);
		await clock.advance(1);
		expect(sockets).toHaveLength(2);
		expect(transport.connectionState).toBe('disconnected');
		await clock.advance(7750);
		expect(transport.connectionState).toBe('suspended');
		expect(transport.error).toBeInstanceOf(Error);

		await letIn();
		expect([transport.connectionState, transport.error]).toEqual(['connected', null]);
	});

	it.each<{ when: string; holds: number; releases: number[]; asked: boolean; kept: boolean }>([
		{ when: 'its only hold is released', holds: 1, releases: [0], asked: false, kept: false },
		{ when: 'one of its two holds is released', holds: 2, releases: [0], asked: false, kept: true },
		{
			when: 'one of its two holds is released twice',
			holds: 2,
			releases: [0, 0],
			asked: false,
			kept: true,
		},
		{
			when: 'its only hold is released while a subscription stands',
			holds: 1,
			releases: [0],
			asked: true,
			kept: true,
		},
	])('once $when, keeps its socket: $kept', async (row) => {
		const { transport, clock, letIn } = rig();
		const releases = Array.from({ length: row.holds }, () => transport.hold());
		if (row.asked) transport.onMessage('a', 'note', () => {});
		const open = await letIn();

		for (const index of row.releases) releases[index]!();

		// Released with nothing asked, it closes as a transport nothing is asked of does.
		expect(open.closed).toEqual(row.kept ? undefined : { code: 1000 });
		expect(transport.connectionState).toBe(row.kept ? 'connected' : 'closed');
		expect(clock.pending === 0).toBe(!row.kept);
	});

	it('is ended by dispose, and a hold taken or released afterwards does nothing', async () => {
		const { transport, clock, sockets, asks, letIn } = rig();
		const release = transport.hold();
		const open = await letIn();

		transport.dispose();
		release();
		transport.hold();
		await clock.advance(120_000);

		expect(open.closed).toEqual({ code: 1000 });
		expect(transport.connectionState).toBe('closed');
		expect([asks(), sockets.length, clock.pending]).toEqual([1, 1, 0]);
	});
});
