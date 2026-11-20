import { describe, expect, it } from 'vitest';

import type { SocketTransport } from '../../src/client/index.ts';
import { attached, message, rig } from './helpers/rig.ts';

/** Hears one channel: what was delivered, and how often each kind of listener was told. */
function listen(transport: SocketTransport, channel: string) {
	const heard = { data: [] as unknown[], lost: 0, firstAttach: 0 };
	transport.onMessage(channel, 'note', (data) => heard.data.push(data));
	transport.onContinuityLost(channel, () => {
		heard.lost += 1;
	});
	transport.onceAttached(channel, () => {
		heard.firstAttach += 1;
	});
	return heard;
}

describe('a cut connection', () => {
	it('resumes from the last sequence heard, each message once and in order', async () => {
		const { transport, clock, letIn } = rig();
		const heard = listen(transport, 'a');
		const first = await letIn();
		first.hear(attached('a', { seq: 4 }));
		first.hear(message('a', 5, 'five'));
		first.hear(message('a', 6, 'six'));

		first.drop();
		await clock.advance(250);
		const second = await letIn();

		expect(second.frames).toEqual([
			{
				t: 'hello',
				epoch: 'epoch-1',
				attach: [{ channel: 'a', since: 6 }],
				watch: [],
				presence: {},
			},
		]);
		second.hear(attached('a', { resumed: true, seq: 8 }));
		second.hear(message('a', 6, 'six', { replayed: true }));
		second.hear(message('a', 7, 'seven', { replayed: true }));
		second.hear(message('a', 8, 'eight', { replayed: true }));
		second.hear(message('a', 9, 'nine'));
		expect(heard).toEqual({
			data: ['five', 'six', 'seven', 'eight', 'nine'],
			lost: 0,
			firstAttach: 1,
		});
	});

	it.each([
		{ reattach: 'resumed', resumed: true, told: 0 },
		{ reattach: 'not resumed, the outage being beyond the log', resumed: false, told: 1 },
	])('tells each channel of a loss $told time(s) when its reattach is $reattach', async (row) => {
		const { transport, clock, letIn } = rig();
		const a = listen(transport, 'a');
		const b = listen(transport, 'b');
		const first = await letIn();
		first.hear(attached('a', { seq: 2 }));
		first.hear(attached('b', { seq: 7 }));

		first.drop();
		await clock.advance(250);
		const second = await letIn();
		second.hear(attached('a', { resumed: row.resumed, seq: 30 }));
		second.hear(attached('b', { resumed: row.resumed, seq: 40 }));
		// What follows is live, or the log's replay: neither tells of a loss again.
		second.hear(message('a', row.resumed ? 3 : 31, 'next'));
		second.hear(message('b', row.resumed ? 8 : 41, 'next'));

		expect([a.lost, b.lost]).toEqual([row.told, row.told]);
		expect([a.data, b.data]).toEqual([['next'], ['next']]);
	});

	it('hears nothing sent before the sequence a lost channel reattached at', async () => {
		const { transport, clock, letIn } = rig();
		const heard = listen(transport, 'a');
		const first = await letIn();
		first.hear(attached('a', { seq: 2 }));
		first.drop();
		await clock.advance(250);
		const second = await letIn();

		second.hear(attached('a', { seq: 30, epoch: 'epoch-2' }));
		second.hear(message('a', 30, 'already read'));
		second.hear(message('a', 31, 'new'));

		expect(heard.data).toEqual(['new']);
		// The epoch a later attach names is the one its sequences belong to.
		transport.onMessage('b', 'note', () => {});
		expect(second.frames.at(-1)).toEqual({ t: 'attach', channel: 'b', epoch: 'epoch-2' });
	});
});

describe('a first attach', () => {
	it.each([
		{ when: 'on an unbroken connection', dropsFirst: false, lost: 0 },
		{ when: 'after the connection dropped before it', dropsFirst: true, lost: 1 },
	])('$when tells of $lost loss(es), and its first-attach listeners once', async (row) => {
		const { transport, clock, letIn, socket } = rig();
		const heard = listen(transport, 'a');
		if (row.dropsFirst) {
			(await socket()).drop();
			await clock.advance(250);
		}

		const open = await letIn();
		open.hear(attached('a', { seq: 12 }));
		open.hear(message('a', 13, 'first'));

		expect(heard).toEqual({ data: ['first'], lost: row.lost, firstAttach: 1 });
	});

	it.each([
		{ asked: 'before the channel attached', askWhen: 'before', told: 1 },
		{ asked: 'while the channel was attached', askWhen: 'attached', told: 0 },
		{ asked: 'after a cut, before the channel reattached', askWhen: 'cut', told: 1 },
	])('tells a listener that asked $asked $told time(s)', async (row) => {
		const { transport, clock, letIn, socket } = rig();
		transport.onMessage('a', 'note', () => {});
		let told = 0;
		const ask = () =>
			transport.onceAttached('a', () => {
				told += 1;
			});

		if (row.askWhen === 'before') ask();
		const first = await letIn();
		first.hear(attached('a'));
		if (row.askWhen === 'attached') ask();
		// Twice more: a listener is told of one attach, never of the ones after it.
		for (let cut = 0; cut < 2; cut += 1) {
			(await socket()).drop();
			if (row.askWhen === 'cut' && cut === 0) ask();
			await clock.advance(250);
			(await letIn()).hear(attached('a', { resumed: true }));
		}

		expect(told).toBe(row.told);
	});
});

describe('a channel asked for again within one round trip', () => {
	// Subscribe, unsubscribe and subscribe again before the object has answered:
	// both attaches are answered, and the first answer is not the second's.
	it('tells of no loss, and hears what follows the attach it last asked for', async () => {
		const { transport, letIn } = rig();
		transport.hold();
		const open = await letIn();
		transport.onMessage('a', 'note', () => {})();
		const heard = listen(transport, 'a');

		open.hear(attached('a', { seq: 4 }));
		open.hear(message('a', 5, 'between'));
		open.hear(attached('a', { seq: 5 }));
		open.hear(message('a', 6, 'after'));

		expect(open.frames.map(({ t }) => t)).toEqual(['hello', 'attach', 'detach', 'attach']);
		expect(heard).toEqual({ data: ['after'], lost: 0, firstAttach: 1 });
	});
});

describe('a one-time attach listener', () => {
	it('releases its channel once told: with nothing else asked, the socket closes', async () => {
		const { transport, letIn } = rig();
		let told = 0;
		transport.onceAttached('a', () => {
			told += 1;
		});
		const open = await letIn();

		open.hear(attached('a'));

		expect(told).toBe(1);
		expect(open.frames.at(-1)).toEqual({ t: 'detach', channel: 'a' });
		expect([open.closed, transport.connectionState]).toEqual([{ code: 1000 }, 'closed']);
	});
});

describe('a channel while attached', () => {
	it.each([
		{ frame: 'a sequence already heard', seq: 5, data: [5], lost: 0 },
		{ frame: 'the next sequence', seq: 6, data: [5, 6], lost: 0 },
		{ frame: 'a sequence past the next', seq: 8, data: [5, 8], lost: 1 },
	])('given $frame, delivers $data and tells of $lost loss(es)', async (row) => {
		const { transport, letIn } = rig();
		const heard = listen(transport, 'a');
		const open = await letIn();
		open.hear(attached('a', { seq: 4 }));
		open.hear(message('a', 5));

		open.hear(message('a', row.seq));

		expect(heard).toMatchObject({ data: row.data, lost: row.lost });
	});

	it('gives a message to the handlers of its name, with the frame it came in', async () => {
		const { transport, letIn } = rig();
		const heard: unknown[] = [];
		transport.onMessage('a', 'note', (data, frame) => heard.push(['note', data, frame.seq]));
		transport.onMessage('a', 'other', (data, frame) => heard.push(['other', data, frame.seq]));
		transport.onMessage('b', 'note', (data, frame) => heard.push(['b', data, frame.seq]));
		const open = await letIn();
		open.hear(attached('a'));
		open.hear(attached('b'));

		open.hear(message('a', 1, 'one'));
		open.hear(message('a', 2, 'two', { name: 'other' }));
		open.hear(message('a', 3, 'three', { name: 'unheard' }));

		expect(heard).toEqual([
			['note', 'one', 1],
			['other', 'two', 2],
		]);
	});

	it('tells every handler of a message when one of them throws, and still throws', async () => {
		const { transport, clock, letIn } = rig();
		const heard: unknown[] = [];
		transport.onMessage('a', 'note', () => {
			throw new Error('a consumer failed');
		});
		transport.onMessage('a', 'note', (data) => heard.push(data));
		const open = await letIn();
		open.hear(attached('a'));

		open.hear(message('a', 1, 'one'));
		open.hear(message('a', 2, 'two'));

		expect(heard).toEqual(['one', 'two']);
		await expect(clock.advance(0)).rejects.toThrow('a consumer failed');
	});
});
