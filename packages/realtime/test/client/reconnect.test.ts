import { describe, expect, it } from 'vitest';

import { attached, message, rig } from './helpers/rig.ts';

// A caller whose credential changes has its socket judged again: what it
// asked is kept, and the next socket asks the address afresh.
describe('reconnect()', () => {
	it('cuts the socket in use, asks the address again at once, and keeps what was asked', async () => {
		const { transport, sockets, asks, letIn } = rig();
		const heard: unknown[] = [];
		const lost: string[] = [];
		transport.onMessage('a', 'note', (data) => heard.push(data));
		transport.onContinuityLost('a', () => lost.push('a'));
		const first = await letIn();
		first.hear(attached('a', { seq: 3 }));

		transport.reconnect();
		const second = await letIn();
		second.hear(attached('a', { seq: 3 }));
		second.hear(message('a', 4, { n: 4 }));

		expect(first.closed).toBeDefined();
		expect([asks(), sockets.length]).toEqual([2, 2]);
		expect(second.frames[0]).toMatchObject({ t: 'hello', attach: [{ channel: 'a', since: 3 }] });
		expect(heard).toEqual([{ n: 4 }]);
		// A socket judged afresh may hear what the last could not: its consumers read again.
		expect(lost).toEqual(['a']);
	});

	it('connects at once when it was waiting to retry', async () => {
		const { transport, sockets, letIn } = rig();
		transport.hold();
		(await letIn()).drop();

		transport.reconnect();
		await letIn();

		expect(sockets).toHaveLength(2);
		expect(transport.connectionState).toBe('connected');
	});

	it('asks for nothing when nothing is asked of it', async () => {
		const { transport, asks } = rig();

		transport.reconnect();

		expect(asks()).toBe(0);
	});
});
