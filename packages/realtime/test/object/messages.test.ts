import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { TestClient } from './client.ts';
import { startServer } from './server.ts';
import type { Delivery, Server } from './server.ts';
import { DEFAULT_RETENTION_MS, MAX_MESSAGE_BYTES } from '../../src/object/limits.ts';

let server: Server;
beforeAll(async () => {
	server = await startServer();
}, 60_000);
afterEach(() => server.closeSockets());
afterAll(() => server.close());

const said = (channel: string, n: number): Delivery => ({ channel, name: 'said', data: { n } });
/** What a socket heard on a channel: each message's sequence and number. */
const heard = (client: TestClient, channel: string): [seq: number, n: number][] =>
	client.messages(channel).map(({ seq, data }) => [seq, (data as { n: number }).n]);

describe('a publish', () => {
	it("reaches the sockets attached to each delivery's channel, and answers its sequence there", async () => {
		const scope = server.scope('PLAIN');
		const [both, news, sport] = [scope.connect(), scope.connect(), scope.connect()];
		await Promise.all([
			both.hello({ attach: [{ channel: 'news' }, { channel: 'sport' }] }),
			news.hello({ attach: [{ channel: 'news' }] }),
			sport.hello({ attach: [{ channel: 'sport' }] }),
		]);

		const answers = await scope.publish(said('news', 1), said('sport', 2), said('news', 3));
		await Promise.all([both.sync(), news.sync(), sport.sync()]);

		expect(answers).toEqual([
			{ channel: 'news', seq: 1, recipients: 2 },
			{ channel: 'sport', seq: 1, recipients: 2 },
			{ channel: 'news', seq: 2, recipients: 2 },
		]);
		expect(heard(news, 'news')).toEqual([
			[1, 1],
			[2, 3],
		]);
		expect(heard(sport, 'sport')).toEqual([[1, 2]]);
		expect(news.messages('sport')).toEqual([]);
		expect(both.messages('news')[0]).toEqual({
			t: 'msg',
			channel: 'news',
			seq: 1,
			name: 'said',
			data: { n: 1 },
			sentAt: expect.any(Number),
		});
	});

	it('is heard in the order published, across calls and across channels', async () => {
		const scope = server.scope();
		const client = scope.connect();
		await client.hello({ attach: [{ channel: 'news' }, { channel: 'sport' }] });

		for (let n = 0; n < 60; n += 3)
			await scope.publish(said('news', n), said('sport', n + 1), said('news', n + 2));
		await client.sync();

		const order = client.frames.flatMap((frame) =>
			frame.t === 'msg' ? [(frame.data as { n: number }).n] : [],
		);
		expect(order).toEqual(Array.from({ length: 60 }, (_, n) => n));
		expect(client.messages('news').map(({ seq }) => seq)).toEqual(
			Array.from({ length: 40 }, (_, n) => n + 1),
		);
	});

	it('is not heard by a socket that detached', async () => {
		const scope = server.scope();
		const client = scope.connect();
		await client.hello({ attach: [{ channel: 'news' }] });

		client.send({ t: 'detach', channel: 'news' });
		await client.sync();
		const [answer] = await scope.publish(said('news', 1));
		await client.sync();

		expect(answer?.recipients).toBe(0);
		expect(client.messages('news')).toEqual([]);
	});
});

describe('a publish that cannot be made whole', () => {
	/** A delivery whose data is `bytes` long as JSON: a string, and its quotes. */
	const sized = (bytes: number): Delivery => ({
		channel: 'news',
		name: 'said',
		data: 'x'.repeat(bytes - 2),
	});

	it.each([
		{ bytes: MAX_MESSAGE_BYTES, published: true },
		{ bytes: MAX_MESSAGE_BYTES + 1, published: false },
	])('of $bytes bytes is published: $published', async ({ bytes, published }) => {
		const scope = server.scope();

		const outcome = await scope.publish(sized(bytes)).then(
			([answer]) => answer?.seq,
			(refused: Error) => refused.message,
		);

		expect(String(outcome)).toMatch(published ? /^1$/ : /at most/);
	});

	// All or nothing: the third is refused, and none of them is heard, logged or numbered.
	it.each([
		{ why: 'too large', third: sized(MAX_MESSAGE_BYTES + 1) },
		{ why: 'on no channel', third: { channel: '', name: 'said', data: 3 } },
	])('publishes nothing of a batch whose third delivery is $why', async ({ third }) => {
		const scope = server.scope();
		const client = scope.connect();
		await client.hello({ attach: [{ channel: 'news' }] });

		await expect(scope.publish(said('news', 1), said('news', 2), third)).rejects.toThrow(
			/Delivery 2/,
		);
		const [next] = await scope.publish(said('news', 3));
		await client.sync();

		expect(next?.seq).toBe(1);
		expect(heard(client, 'news')).toEqual([[1, 3]]);
		expect(await scope.call('stored')).toMatchObject({ log: 1 });
	});
});

describe('the log', () => {
	// A scope that goes quiet does not keep its last burst.
	it.each([
		{ after: DEFAULT_RETENTION_MS - 5000, kept: 1 },
		{ after: DEFAULT_RETENTION_MS, kept: 0 },
	])(
		'keeps $kept message(s) $after ms after a publish, with none since',
		async ({ after, kept }) => {
			const scope = server.scope();
			await scope.publish(said('news', 1));

			await scope.advance(after);

			expect(await scope.call('stored')).toMatchObject({ log: kept });
		},
	);
});

describe('an attach', () => {
	it('with no sequence is told the head, and replayed nothing', async () => {
		const scope = server.scope();
		await scope.publish(said('news', 1), said('news', 2));

		const client = scope.connect();
		await client.hello({ attach: [{ channel: 'news' }] });

		expect(client.attached('news')).toEqual({
			t: 'attached',
			channel: 'news',
			resumed: false,
			seq: 2,
			epoch: expect.any(String),
			connectionId: expect.any(String),
		});
		expect(client.messages('news')).toEqual([]);
	});

	it.each(['hello', 'attach'] as const)(
		'by %s replays what the socket missed since the sequence it held, then goes on live',
		async (by) => {
			const scope = server.scope();
			const first = scope.connect();
			await first.hello({ attach: [{ channel: 'news' }] });
			await scope.publish(said('news', 1), said('news', 2));
			await first.sync();
			const epoch = first.attached('news')?.epoch as string;
			first.close();
			await first.closed;
			await scope.publish(said('news', 3), said('news', 4), said('news', 5));

			const back = scope.connect();
			if (by === 'hello') await back.hello({ epoch, attach: [{ channel: 'news', since: 2 }] });
			else back.send({ t: 'attach', channel: 'news', since: 2, epoch });
			await back.sync();
			await scope.publish(said('news', 6));
			await back.sync();

			expect(back.attached('news')).toMatchObject({ resumed: true, seq: 5, epoch });
			expect(back.messages('news').map(({ seq, replayed }) => [seq, replayed])).toEqual([
				[3, true],
				[4, true],
				[5, true],
				[6, undefined],
			]);
			expect(heard(back, 'news')).toEqual([
				[3, 3],
				[4, 4],
				[5, 5],
				[6, 6],
			]);
		},
	);

	// Continuity is lost whenever the log cannot prove nothing was missed.
	it.each([
		{ why: 'its epoch is not this storage', epoch: 'another', since: 1 },
		{ why: 'its sequence is past the head', epoch: undefined, since: 9 },
	])('is told of a loss when $why', async ({ epoch, since }) => {
		const scope = server.scope();
		const first = scope.connect();
		await first.hello({ attach: [{ channel: 'news' }] });
		await scope.publish(said('news', 1), said('news', 2));

		const back = scope.connect();
		await back.hello({
			epoch: epoch ?? (first.attached('news')?.epoch as string),
			attach: [{ channel: 'news', since }],
		});

		expect(back.attached('news')).toMatchObject({ resumed: false, seq: 2 });
		expect(back.messages('news')).toEqual([]);
	});

	// The log covers a gap only while every message in it is still kept.
	it.each([
		{ since: 1, resumed: false, replayed: [] },
		{ since: 3, resumed: true, replayed: [4] },
	])(
		'holding $since of 4, after the log pruned up to 3, resumes: $resumed',
		async ({ since, resumed, replayed }) => {
			const scope = server.scope();
			const first = scope.connect();
			await first.hello({ attach: [{ channel: 'news' }] });
			await scope.publish(said('news', 1), said('news', 2), said('news', 3));
			await scope.advance(DEFAULT_RETENTION_MS);
			await scope.publish(said('news', 4));

			const back = scope.connect();
			await back.hello({
				epoch: first.attached('news')?.epoch as string,
				attach: [{ channel: 'news', since }],
			});

			expect(back.attached('news')).toMatchObject({ resumed, seq: 4 });
			expect(back.messages('news').map(({ seq }) => seq)).toEqual(replayed);
		},
	);

	it('to a wiped object is told of the loss by its new epoch, and counts from the start', async () => {
		const scope = server.scope();
		const first = scope.connect();
		await first.hello({ attach: [{ channel: 'news' }] });
		await scope.publish(said('news', 1), said('news', 2));
		const epoch = first.attached('news')?.epoch as string;

		await scope.call('wipe');
		await scope.restart();
		const back = scope.connect();
		await back.hello({ epoch, attach: [{ channel: 'news', since: 2 }] });

		expect(back.attached('news')).toMatchObject({ resumed: false, seq: 0 });
		expect(back.attached('news')?.epoch).not.toBe(epoch);
	});
});

describe('a socket', () => {
	it('is answered a ping while the object sleeps, without waking it', async () => {
		const scope = server.scope();
		const client = scope.connect();
		await client.hello({ attach: [{ channel: 'news' }] });
		const wakes = await scope.call<number>('wakes');

		await scope.hibernate();
		await client.ping();
		// Put to sleep again if the ping woke it, which the harness refuses when it
		// did not: an object left awake would answer the count without a wake.
		await scope.hibernate().catch(() => {});

		// Asking woke it once. A ping that had woken it would make that twice.
		expect(await scope.call<number>('wakes')).toBe(wakes + 1);
	});

	it('that sends what is no frame is left as it was', async () => {
		const scope = server.scope();
		const client = scope.connect();
		await client.hello({ attach: [{ channel: 'news' }] });

		client.sendText('not json');
		client.sendText(JSON.stringify({ t: 'attach' }));
		client.sendText(JSON.stringify({ t: 'publish', channel: 'news', name: 'said', data: 1 }));
		await client.sync();
		const [answer] = await scope.publish(said('news', 1));
		await client.sync();

		expect(answer?.recipients).toBe(1);
		expect(heard(client, 'news')).toEqual([[1, 1]]);
	});
});
