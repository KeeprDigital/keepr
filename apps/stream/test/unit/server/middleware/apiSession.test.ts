import { beforeEach, describe, expect, it } from 'vitest';
import {
	A_MEMBER,
	AN_ADMINISTRATOR,
	AN_OUTSIDER,
	type Asker,
	keeprAccountsBinding,
	SIGNED_OUT,
	stubServerGlobals,
	workerRequest,
} from '~~/test/helpers/keeprAccounts';
import { serverMiddlewareFiles } from '~~/test/helpers/routeRefusalScan';

/**
 * The deny-by-default Session boundary as the middleware answers it (ADR-0010,
 * ADR-0141), over the real identity reading: only Keepr Accounts is stood in
 * for, by the Accounts Stand-in behind the Worker's binding.
 *
 * The path policy is exercised against every route on disk in
 * `test/unit/server/utils/apiBoundary.test.ts`; what is left for here is what
 * this file adds to it: who a private path admits and how it refuses everyone
 * else, that an exempt path is not asked who it belongs to **at all**, and that
 * a write another site's page made is refused before anyone is asked.
 */

stubServerGlobals();

const accounts = keeprAccountsBinding();
const handler = (await import('~~/server/middleware/api-session')).default;

/** What the boundary answers `as` on `path`: admitted, or the refusal's status, words and code. */
async function answered(
	as: Asker,
	{
		path = '/api/events/1/players',
		method = 'GET',
		headers = {},
		env = { KEEPR_ACCOUNTS: accounts } as Record<string, unknown>,
	} = {},
) {
	try {
		await handler(workerRequest({ as, path, method, headers, env }));
		return 'admitted';
	} catch (refusal) {
		const { statusCode, message, data } = refusal as {
			statusCode: number;
			message: string;
			data?: { code?: string };
		};
		return { statusCode, message, code: data?.code };
	}
}

beforeEach(() => {
	accounts.asked.length = 0;
});

describe('the Session boundary', () => {
	it.each([
		['a User with App access', A_MEMBER],
		['a Graphics Administrator', AN_ADMINISTRATOR],
	])('admits %s, on their Identity Proof', async (_case, as) => {
		expect(await answered(as)).toBe('admitted');
	});

	// One message for every route.
	it.each([
		['/api/events/1/screens/2/command'],
		['/api/graphics-assets'],
		['/api/admin/graphics-assets/health'],
		['/api/identity'],
	])('refuses a request with no Identity Proof on %s, as one uniform 401', async (path) => {
		expect(await answered(SIGNED_OUT, { path })).toEqual({
			statusCode: 401,
			message: 'Authentication is required',
			code: undefined,
		});
	});

	it('refuses a User with no App access to Stream Keepr, as every App refuses one', async () => {
		expect(await answered(AN_OUTSIDER)).toMatchObject({ statusCode: 403, code: 'NO_APP_ACCESS' });
	});

	// Nothing admits a request Keepr Accounts did not vouch for: with nobody to
	// ask, the answer is a 503, never an admission. What it says is the layer's.
	it.each([
		['is not bound', {}, 'KEEPR_ACCOUNTS is not bound'],
		[
			'cannot be reached',
			{
				KEEPR_ACCOUNTS: {
					fetch: async () => {
						throw new Error('connection lost');
					},
				},
			},
			'Keepr Accounts could not be asked who you are',
		],
	])('refuses everyone while Keepr Accounts %s, 503', async (_case, env, says) => {
		const refusal = await answered({ user: 'nobody-asked-before' }, { env });

		expect(refusal).toMatchObject({ statusCode: 503, message: expect.stringContaining(says) });
	});

	// Asking would make the clock, the Release and the capability surface depend
	// on Keepr Accounts: the surfaces that have to keep working for a machine
	// showing program, and for the deploy's verify.
	it.each([
		['/api/time', 'GET'],
		['/api/release', 'GET'],
		['/api/public/events/1/on-air', 'GET'],
		['/api/screen-output/screens/7/asset-capability-session', 'POST'],
		['/event/1/screens/2', 'GET'],
	])('does not ask who %s belongs to, rather than asking and allowing', async (path, method) => {
		expect(await answered(SIGNED_OUT, { path, method })).toBe('admitted');
		expect(accounts.asked).toEqual([]);
	});

	// The router matches the path as sent, and the URL parser resolves dot
	// segments, percent-encoded ones included, and reads `\` as `/`. A spelling
	// either of them reads as private is private.
	it.each([
		['a percent-encoded climb from a private path to an exempt one', '/api/events/%2e%2e/time'],
		['a mixed-case percent-encoded climb', '/api/events/.%2E/time'],
		['a backslash climb from a private path to an exempt one', '/api/events\\..\\time'],
		['a percent-encoded climb out of an exempt surface', '/api/screen-output/%2e%2e/events/1'],
		['a backslash climb out of an exempt surface', '/api/screen-output\\..\\events/1'],
		['backslashes for slashes', '/api\\events\\1\\players'],
	])('refuses %s with no Identity Proof, 401', async (_case, path) => {
		expect(await answered(SIGNED_OUT, { path })).toMatchObject({ statusCode: 401 });
	});

	// The Screen Output Link exchange carries its credential in its body: OBS's
	// browser source or a script POSTs it from anywhere, and no Session decides it.
	it('leaves a cross-site POST to an exempt surface to its own guard', async () => {
		expect(
			await answered(SIGNED_OUT, {
				path: '/api/screen-output/link',
				method: 'POST',
				headers: {
					'sec-fetch-site': 'cross-site',
					origin: 'https://not-this-installation.example',
				},
			}),
		).toBe('admitted');
	});

	// Wiring for `requestIsCrossSiteMutation`: a signed-in browser made to POST
	// by another site is refused before a handler runs; its own page, and a
	// client that names no origin at all, are admitted.
	it.each([
		[
			'its own page',
			'admitted',
			{ 'sec-fetch-site': 'same-origin', origin: 'https://stream.example' },
		],
		[
			'its own page, in a browser without Sec-Fetch-Site',
			'admitted',
			{ origin: 'https://stream.example' },
		],
		['a script or test that names no origin', 'admitted', {}],
		['a sibling subdomain', 403, { 'sec-fetch-site': 'same-site', origin: 'https://evil.example' }],
		[
			'another site, in a browser without Sec-Fetch-Site',
			403,
			{ origin: 'https://not-this-installation.example' },
		],
	] as const)('answers a signed-in POST from %s: %s', async (_from, outcome, headers) => {
		const answer = await answered(A_MEMBER, {
			path: '/api/events/1/screens/2/command',
			method: 'POST',
			headers,
		});

		expect(typeof answer === 'string' ? answer : answer.statusCode).toBe(outcome);
	});

	it('refuses a cross-site POST as Forbidden, in words that say why, before anyone is asked', async () => {
		// A User no earlier row asked about, so no Identity Proof already held stands in for the ask.
		expect(
			await answered(
				{ user: 'never-asked-about' },
				{
					path: '/api/events',
					method: 'POST',
					headers: { 'sec-fetch-site': 'cross-site' },
				},
			),
		).toEqual({ statusCode: 403, message: 'Cross-site request refused', code: undefined });
		expect(accounts.asked).toEqual([]);
	});

	it('admits a cross-site read of a private route, which changes nothing', async () => {
		expect(
			await answered(A_MEMBER, {
				headers: { 'sec-fetch-site': 'cross-site', origin: 'https://elsewhere.example' },
			}),
		).toBe('admitted');
	});

	it('sorts ahead of every other middleware, which is the order Nitro composes them in', () => {
		// Load-bearing, and the reason the file is named `api-session.ts`:
		// `event-exists.ts` answers 404 for an Event that is not there, and running
		// it first would let a signed-out caller read which Event ids exist off the
		// difference between 404 and 401; `request-body-limit.ts` would tell one
		// what the body ceiling is. Read off the directory, so a middleware added
		// tomorrow with an earlier name fails here.
		const names = serverMiddlewareFiles().map((file) => file.slice(file.lastIndexOf('/') + 1));

		expect(names[0]).toBe('api-session.ts');
		expect([...names].sort()).toEqual(names);
	});
});
