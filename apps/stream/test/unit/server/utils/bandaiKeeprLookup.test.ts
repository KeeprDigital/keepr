import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BANDAI_KEEPR_MAX_RESPONSE_BYTES, lookupOpCard } from '~~/server/utils/bandaiKeepr';
import { bandaiKeeprCard } from '~~/test/helpers/opCards';

// The number lookup over bandai-keepr, faked at `fetch`, and the Workers Cache
// it keeps answers in, faked at `caches`.

const config = { apiUrl: 'https://op-api.test', apiKey: 'test-key' };
const zoro = bandaiKeeprCard({
	number: 'OP01-001',
	name: 'Roronoa Zoro',
	category: 'leader',
	colors: ['Red'],
});
const cardUrl = 'https://op-api.test/cards/OP01-001';

const cached = new Map<string, Response>();
let answer: () => Response;
const fetched = vi.fn();

beforeEach(() => {
	cached.clear();
	fetched.mockClear();
	answer = () => Response.json(zoro);
	vi.stubGlobal('caches', {
		open: async () => ({
			match: async (key: string) => cached.get(key)?.clone(),
			put: async (key: string, response: Response) => void cached.set(key, response),
			delete: async (key: string) => cached.delete(key),
		}),
	});
	vi.stubGlobal('fetch', async () => {
		fetched();
		return answer();
	});
});

afterEach(() => {
	vi.useRealTimers();
});

describe('looking a card number up on bandai-keepr', () => {
	it('answers a cached card without asking bandai-keepr', async () => {
		cached.set(cardUrl, Response.json(zoro));

		expect(await lookupOpCard(config, 'OP01-001')).toMatchObject({ name: 'Roronoa Zoro' });
		expect(fetched).not.toHaveBeenCalled();
	});

	// An answer cached before its schema changed would otherwise fail every
	// lookup of that card until the cache let it go.
	it('asks bandai-keepr again for a cached answer its schema refuses, and caches the new one', async () => {
		cached.set(cardUrl, Response.json({ number: 'OP01-001' }));

		expect(await lookupOpCard(config, 'OP01-001')).toMatchObject({ name: 'Roronoa Zoro' });
		expect(fetched).toHaveBeenCalledOnce();
		expect(await cached.get(cardUrl)!.clone().json()).toMatchObject({ name: 'Roronoa Zoro' });
	});

	it.each([
		{
			case: 'an answer past its size bound',
			// Valid JSON, padded past the bound: only the bound refuses it.
			respond: () =>
				new Response(`${' '.repeat(BANDAI_KEEPR_MAX_RESPONSE_BYTES)}${JSON.stringify(zoro)}`),
		},
		{
			case: 'an answer whose body never ends',
			respond: () =>
				new Response(
					new ReadableStream({
						start(controller) {
							controller.enqueue(new TextEncoder().encode('{"number":'));
						},
					}),
				),
		},
	])('fails on $case, caching nothing', async ({ respond }) => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		answer = respond;

		const failure = lookupOpCard(config, 'OP01-001').catch((error: unknown) => error);
		await vi.advanceTimersByTimeAsync(60_000);

		expect(await failure).toMatchObject({ code: 'BANDAI_KEEPR_UPSTREAM_FAILURE' });
		expect(cached.size).toBe(0);
	});
});
