import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	createGraphicsRemoteSourceFetcher,
	GraphicsRemoteSourceDeadlineError,
} from '~~/server/modules/graphics-asset-library/remote-source';

// An approved remote copy is bounded in time as in bytes: the name lookups, the
// fetch and its body share one total deadline, and the body may not go quiet past
// an idle one. Only the clock, the resolver and the network are faked.

const TOTAL = 10_000;
const IDLE = 2_000;
const publicHost = {
	resolve: async () => ({ outcome: 'resolved', addresses: ['93.184.216.34'] }) as const,
};
const never = <T>() => new Promise<T>(() => {});

function fetcher(dependencies: Partial<Parameters<typeof createGraphicsRemoteSourceFetcher>[0]>) {
	return createGraphicsRemoteSourceFetcher({
		resolver: publicHost,
		fetch: async () => new Response(Uint8Array.of(1)),
		deadlines: { totalMilliseconds: TOTAL, idleMilliseconds: IDLE },
		...dependencies,
	});
}

function open(remote: ReturnType<typeof fetcher>) {
	return remote.open({ sourceUrl: 'https://cdn.example.test/a.png', maximumByteLength: 1_000 });
}

/** A body that sends one chunk per `delays` entry, each after waiting that long. */
function trickle(delays: number[]) {
	let sent = 0;
	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			if (sent === delays.length) return controller.close();
			await new Promise((resolve) => setTimeout(resolve, delays[sent]));
			sent += 1;
			controller.enqueue(Uint8Array.of(sent));
		},
	});
}

async function drain(body: ReadableStream<Uint8Array>) {
	const reader = body.getReader();
	for (;;) if ((await reader.read()).done) return;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('an approved remote copy’s deadlines', () => {
	it.each([
		{ stall: 'its name lookup', remote: () => fetcher({ resolver: { resolve: never } }) },
		{ stall: 'its fetch', remote: () => fetcher({ fetch: never }) },
	])('answers unavailable when $stall outlasts the total deadline', async ({ remote }) => {
		const opening = open(remote());

		await vi.advanceTimersByTimeAsync(TOTAL);

		await expect(opening).resolves.toMatchObject({ outcome: 'unavailable' });
	});

	it('aborts the request it gave up on', async () => {
		let signal: AbortSignal | undefined;
		const opening = open(
			fetcher({
				fetch: (request) => {
					signal = request.signal;
					return never();
				},
			}),
		);

		await vi.advanceTimersByTimeAsync(TOTAL);
		await opening;

		expect(signal?.aborted).toBe(true);
	});

	it.each([
		{ body: 'goes quiet past the idle deadline', delays: [0, IDLE + 1] },
		{ body: 'trickles past the total deadline', delays: Array.from({ length: 8 }, () => IDLE - 1) },
	])('fails a body that $body', async ({ delays }) => {
		const opened = await open(fetcher({ fetch: async () => new Response(trickle(delays)) }));
		if (opened.outcome !== 'open') throw new Error('expected the source to open');

		const draining = drain(opened.body);
		const failed = expect(draining).rejects.toBeInstanceOf(GraphicsRemoteSourceDeadlineError);
		await vi.advanceTimersByTimeAsync(TOTAL + IDLE);

		await failed;
	});

	it('delivers a body that keeps within both deadlines', async () => {
		const opened = await open(
			fetcher({ fetch: async () => new Response(trickle([IDLE - 1, IDLE - 1])) }),
		);
		if (opened.outcome !== 'open') throw new Error('expected the source to open');

		const draining = drain(opened.body);
		await vi.advanceTimersByTimeAsync(2 * IDLE);

		await expect(draining).resolves.toBeUndefined();
	});
});
