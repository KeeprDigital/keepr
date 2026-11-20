import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
	DEFAULT_SOCKETS_PER_IDENTITY,
	FRAME_BURST,
	MAX_CLIENT_FRAME_LENGTH,
	MAX_HELLO_ENTRIES,
} from '../../src/object/limits.ts';
import { CLOSE_CROWDED, CLOSE_RATE_LIMITED, CLOSE_TOO_LARGE } from '../../src/protocol.ts';
import type { AttachRequest } from '../../src/protocol.ts';
import { anyone, startServer } from './server.ts';
import type { Server } from './server.ts';
import type { TestClient } from './client.ts';

let server: Server;
beforeAll(async () => {
	server = await startServer();
}, 60_000);
afterEach(() => server.closeSockets());
afterAll(() => server.close());

const said = (n: number) => ({ channel: 'news', name: 'said', data: { n } });

/** The code the socket was closed with, or `open` once the object has answered all it sent. */
async function fate(client: TestClient): Promise<number | 'open'> {
	const closed = client.closed.then(({ code }) => code);
	return Promise.race([
		closed,
		client.sync().then(
			() => 'open' as const,
			() => closed,
		),
	]);
}

describe('a hello', () => {
	// Each entry would otherwise replay the channel's whole log.
	it('attaches a channel it names many times once, and replays its log once', async () => {
		const scope = server.scope();
		const first = scope.connect();
		await first.hello({ attach: [{ channel: 'news' }] });
		await scope.publish(said(1), said(2));
		const epoch = first.attached('news')?.epoch as string;

		const back = scope.connect();
		await back.hello({
			epoch,
			attach: Array.from({ length: MAX_HELLO_ENTRIES }, () => ({ channel: 'news', since: 0 })),
		});

		expect(back.frames.filter((frame) => frame.t === 'attached')).toHaveLength(1);
		expect(back.messages('news').map(({ seq }) => seq)).toEqual([1, 2]);
	});

	it.each([
		{ entries: MAX_HELLO_ENTRIES, fate: 'open', told: true },
		{ entries: MAX_HELLO_ENTRIES + 1, fate: CLOSE_TOO_LARGE, told: false },
	])('of $entries entries meets $fate, before any log is read', async (row) => {
		const scope = server.scope();
		await scope.publish(said(1));
		const client = scope.connect();
		const attach: AttachRequest[] = Array.from({ length: row.entries }, (_, n) => ({
			channel: `c${n}`,
		}));

		client.send({ t: 'hello', attach });

		// Closed, it was told nothing: no channel was attached, and no log read.
		expect([await fate(client), client.frames.length > 0]).toEqual([row.fate, row.told]);
	});
});

describe('a frame', () => {
	it.each([
		{ length: MAX_CLIENT_FRAME_LENGTH, expected: 'open' },
		{ length: MAX_CLIENT_FRAME_LENGTH + 1, expected: CLOSE_TOO_LARGE },
	])('of $length characters meets $expected', async ({ length, expected }) => {
		const scope = server.scope();
		const client = scope.connect();
		const frame = JSON.stringify({ t: 'update', channel: 'news', data: '' });

		client.sendText(frame.replace('""', `"${'x'.repeat(length - frame.length)}"`));

		expect(await fate(client)).toBe(expected);
	});
});

describe("a socket's frames", () => {
	it.each([
		// The last row's frames are the burst with the sync's own watch.
		{ sent: FRAME_BURST - 1, expected: 'open' },
		{ sent: FRAME_BURST * 2, expected: CLOSE_RATE_LIMITED },
	])('of $sent at once meet $expected', async ({ sent, expected }) => {
		const scope = server.scope();
		const client = scope.connect();
		await client.opened;

		for (let n = 0; n < sent; n += 1) client.send({ t: 'detach', channel: 'news' });

		expect(await fate(client)).toBe(expected);
	});
});

describe("an identity's sockets", () => {
	it('retire the oldest once one more would hold more than the scope allows, and no other', async () => {
		const scope = server.scope();
		const reader = { ...anyone, identity: 'reader' };
		const sockets = [];
		for (let n = 0; n < DEFAULT_SOCKETS_PER_IDENTITY; n += 1) {
			const socket = scope.connect(reader);
			await socket.hello();
			sockets.push(socket);
		}
		const other = scope.connect();
		await other.hello();

		const newest = scope.connect(reader);
		await newest.hello();
		await Promise.all([...sockets.slice(1), other].map((socket) => socket.sync()));

		expect(await sockets[0]?.closed).toMatchObject({ code: CLOSE_CROWDED });
		expect([...sockets.slice(1), other, newest].filter((socket) => socket.isClosed())).toEqual([]);
	});
});
