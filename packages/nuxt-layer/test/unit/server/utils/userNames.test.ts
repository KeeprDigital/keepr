import type { AccountsConnection } from '../../../../server/utils/requestIdentity';
import { createApp, eventHandler, toWebHandler } from 'h3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUserNameReader, readUserNames } from '../../../../server/utils/userNames';
import { askedUserIds, USER_NAMES_MAX_IDS } from '../../../../shared/utils/userNames';

// What an App is told to call a User other than its reader (ADR-0145): asked of
// Keepr Accounts with the request's own cookie, kept as long as an Identity
// Proof lasts, and never a reason to fail the reading. Only the connection is
// faked; whose names Keepr Accounts tells is tested at its home, `apps/accounts`.

const MINUTE_MS = 60 * 1000;

/** Every question the connection was asked: the cookie it carried and the ids it named. */
let questions: { address: string; cookie: string | null; ids: string[] }[];

/** Keepr Accounts as the binding answers, telling each cookie the names in its `directory`. */
function keeprAccounts(directory: Record<string, Record<string, unknown>>): AccountsConnection {
	return {
		async fetch(input, init) {
			const request = new Request(input, init);
			const cookie = request.headers.get('cookie');
			const ids = askedUserIds(new URL(request.url));
			questions.push({ address: request.url.split('?')[0]!, cookie, ids });
			const known = directory[cookie ?? ''] ?? {};
			return Response.json({
				names: Object.fromEntries(Object.entries(known).filter(([id]) => ids.includes(id))),
			});
		},
	};
}

const answering = (answer: () => Response | Promise<Response>): AccountsConnection => ({
	async fetch(input, init) {
		const request = new Request(input, init);
		questions.push({ address: request.url, cookie: null, ids: askedUserIds(new URL(request.url)) });
		return await answer();
	},
});

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], now: 0 });
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	questions = [];
});

afterEach(() => vi.useRealTimers());

describe('the names an App reads', () => {
	it('are those Keepr Accounts tells the cookie, and of the Users asked about alone', async () => {
		const read = createUserNameReader();
		const accounts = answering(() =>
			Response.json({ names: { ada: 'Ada Lovelace', bo: '  ', cy: 7, unasked: 'Nobody Asked' } }),
		);

		expect(
			await read({ cookie: 'session=grace', accounts, ids: ['ada', 'bo', 'cy', 'dee'] }),
		).toEqual({ ada: 'Ada Lovelace' });
	});

	it('asks in questions of no more ids than Keepr Accounts takes, each id once and none blank', async () => {
		const read = createUserNameReader();
		const ids = Array.from({ length: USER_NAMES_MAX_IDS * 2 + 1 }, (_, index) => `user-${index}`);
		const last = ids.at(-1)!;

		const names = await read({
			cookie: 'session=grace',
			accounts: keeprAccounts({ 'session=grace': { [last]: 'Last Asked' } }),
			ids: [...ids, '', ...ids],
		});

		expect(names).toEqual({ [last]: 'Last Asked' });
		expect(questions.map((question) => question.ids.length)).toEqual([
			USER_NAMES_MAX_IDS,
			USER_NAMES_MAX_IDS,
			1,
		]);
		expect(questions.flatMap((question) => question.ids).toSorted()).toEqual(ids.toSorted());
	});

	it('asks nothing when there is nobody to ask about', async () => {
		const read = createUserNameReader();

		expect(await read({ accounts: keeprAccounts({}), ids: ['', ''] })).toEqual({});
		expect(questions).toEqual([]);
	});
});

describe('a reading is never failed for want of a name', () => {
	const named = () => Response.json({ names: { ada: 'Ada Lovelace' } });

	// Each failure names nobody and keeps nothing: the reading after it asks again.
	it.each<[string, () => Response | Promise<Response>]>([
		[
			'the connection fails',
			() => {
				throw new Error('Network connection lost.');
			},
		],
		[
			// Only an answer is read: a refusal names nobody, whatever its body holds.
			'it refuses the question',
			() => Response.json({ names: { ada: 'Not Found' } }, { status: 404 }),
		],
		[
			'a Keepr Accounts with no such route yet answers its page in place of names',
			() => new Response('<!DOCTYPE html>', { headers: { 'content-type': 'text/html' } }),
		],
		['it answers names in no shape this reads', () => Response.json({ names: 'nobody' })],
		['it does not answer in time', () => new Promise<Response>(() => {})],
	])('when %s, nobody is named, and the next reading asks again', async (_case, failure) => {
		const read = createUserNameReader({ timeoutMs: 2000 });
		let failing = true;
		const accounts = answering(() => (failing ? failure() : named()));

		const names = read({ cookie: 'session=grace', accounts, ids: ['ada'] });
		await vi.advanceTimersByTimeAsync(2000);
		expect(await names).toEqual({});
		failing = false;

		expect(await read({ cookie: 'session=grace', accounts, ids: ['ada'] })).toEqual({
			ada: 'Ada Lovelace',
		});
	});
});

describe('what Keepr Accounts answered is kept', () => {
	const directory = { 'session=grace': { ada: 'Ada Lovelace' } };

	it('for as long as an Identity Proof lasts, a User it left unnamed included', async () => {
		const read = createUserNameReader();
		const accounts = keeprAccounts(directory);
		const ask = async () =>
			await read({ cookie: 'session=grace', accounts, ids: ['ada', 'ghost'] });

		const first = await ask();
		vi.setSystemTime(5 * MINUTE_MS - 1);
		const kept = await ask();
		expect(questions).toHaveLength(1);

		vi.setSystemTime(5 * MINUTE_MS);
		const asked = await ask();

		expect([first, kept, asked]).toEqual(Array(3).fill({ ada: 'Ada Lovelace' }));
		expect(questions.map((question) => question.ids)).toEqual([
			['ada', 'ghost'],
			['ada', 'ghost'],
		]);
	});

	it('under the cookie it was given to: another asks for itself, and is told its own answer', async () => {
		const read = createUserNameReader();
		const accounts = keeprAccounts(directory);
		await read({ cookie: 'session=grace', accounts, ids: ['ada'] });

		expect(await read({ cookie: 'session=mallory', accounts, ids: ['ada'] })).toEqual({});
		expect(questions.map((question) => question.cookie)).toEqual([
			'session=grace',
			'session=mallory',
		]);
	});

	it('for no more answers than its size, the oldest dropped first', async () => {
		const read = createUserNameReader({ cacheSize: 1 });
		const accounts = keeprAccounts(directory);
		await read({ cookie: 'session=grace', accounts, ids: ['ada'] });
		await read({ cookie: 'session=grace', accounts, ids: ['ghost'] });

		await read({ cookie: 'session=grace', accounts, ids: ['ghost'] });
		await read({ cookie: 'session=grace', accounts, ids: ['ada'] });

		expect(questions.map((question) => question.ids)).toEqual([['ada'], ['ghost'], ['ada']]);
	});
});

// How an App's route meets the reader: the binding it reads and the cookie it forwards.
describe('readUserNames', () => {
	const GRACE = '__Secure-better-auth.session_token=grace';

	async function namesFor(env: Record<string, unknown>) {
		const app = createApp();
		app.use(
			eventHandler(async (event) => {
				event.context.cloudflare = { env };
				return await readUserNames(event, ['ada'], createUserNameReader());
			}),
		);
		const response = await toWebHandler(app)(
			new Request('https://stream.keepr.digital/api/reading', {
				headers: { cookie: `theme=dark; ${GRACE}` },
			}),
		);
		return await response.json();
	}

	it('asks Keepr Accounts over the KEEPR_ACCOUNTS binding, with the request’s cookies that are its own', async () => {
		const names = await namesFor({
			KEEPR_ACCOUNTS: keeprAccounts({ [GRACE]: { ada: 'Ada Lovelace' } }),
		});

		expect(names).toEqual({ ada: 'Ada Lovelace' });
		expect(questions).toEqual([
			{
				address: 'https://accounts.keepr.digital/api/users/names',
				cookie: GRACE,
				ids: ['ada'],
			},
		]);
	});

	it('names nobody in an App with no binding', async () => {
		expect(await namesFor({})).toEqual({});
	});
});
