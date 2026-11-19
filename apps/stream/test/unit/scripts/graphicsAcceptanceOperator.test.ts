import { describe, expect, it, vi } from 'vitest';
import { ACCEPTANCE_FAILURE_CODES } from '../../../scripts/graphics-acceptance/evidence.mjs';
import {
	ACCOUNTS_ORIGIN_ENV,
	isLoopbackOrigin,
	keeprAccountsOriginOf,
	LOCAL_SIGNED_OUT_COOKIE,
	openOperatorSession,
	OPERATOR_EMAIL_ENV,
	OPERATOR_PASSWORD_ENV,
	operatorCredentialPlan,
	operatorUnavailableNotice,
} from '../../../scripts/graphics-acceptance/operator.mjs';

// How an acceptance run becomes an operator behind the deny-by-default Session
// boundary (ADR-0141): a local run is vouched for by its installation's Accounts
// Stand-in, and a deployed run signs in to the Installation's Keepr Accounts.

const CREDENTIALS = {
	[OPERATOR_EMAIL_ENV]: 'ops@keepr.digital',
	[OPERATOR_PASSWORD_ENV]: 'their-password',
};

/** The plan for an environment, with stderr silenced where it refuses. */
function planFor(options: Parameters<typeof operatorCredentialPlan>[0]) {
	vi.spyOn(process.stderr, 'write').mockReturnValue(true);
	return operatorCredentialPlan(options);
}

describe('how an acceptance run acquires an operator', () => {
	it('needs no credential locally, and takes none from the environment', () => {
		expect(planFor({ env: CREDENTIALS })).toEqual({ kind: 'stand-in' });
	});

	it('signs a deployed run in as the User the environment names', () => {
		expect(planFor({ deployed: true, env: CREDENTIALS })).toEqual({
			kind: 'sign-in',
			email: 'ops@keepr.digital',
			password: 'their-password',
		});
	});

	it.each([
		['no credential', {}],
		['a blank password', { ...CREDENTIALS, [OPERATOR_PASSWORD_ENV]: '   ' }],
		['half a credential', { [OPERATOR_EMAIL_ENV]: 'ops@keepr.digital' }],
	])('refuses a deployed run with %s rather than signing in with nothing', (_, env) => {
		expect(() => planFor({ deployed: true, env })).toThrow(
			expect.objectContaining({ code: 'harness-operator-unavailable' }),
		);
	});

	it('stops with a registered code, and prose above it', () => {
		const written = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

		expect(() => operatorCredentialPlan({ deployed: true, env: {} })).toThrow(
			expect.objectContaining({
				code: 'harness-operator-unavailable',
				detail: { mode: 'deployed' },
			}),
		);
		expect(ACCEPTANCE_FAILURE_CODES).toContain('harness-operator-unavailable');
		expect(written).toHaveBeenCalledTimes(1);
		expect(written.mock.calls[0]![0]).toBe(`${operatorUnavailableNotice()}\n`);
	});

	it('names what to set, and never a local file a deployed run does not read', () => {
		const notice = operatorUnavailableNotice();

		expect(notice).not.toContain('.env');
		expect(notice).toContain(OPERATOR_EMAIL_ENV);
		expect(notice).toContain(OPERATOR_PASSWORD_ENV);
		expect(notice).toContain('Keepr Accounts');
	});
});

// Staging's run signs in at Staging's Keepr Accounts, never at Production's.
describe('the Keepr Accounts an Installation relies on', () => {
	it.each([
		['https://stream.keepr.digital', 'https://accounts.keepr.digital'],
		['https://stream.keepr-staging.digital', 'https://accounts.keepr-staging.digital'],
	])('is the accounts host of %s: %s', (origin, accounts) => {
		expect(keeprAccountsOriginOf(origin)).toBe(accounts);
	});

	it('is the one the environment names, where it names one', () => {
		expect(
			keeprAccountsOriginOf('https://stream.keepr.digital', {
				[ACCOUNTS_ORIGIN_ENV]: 'https://accounts.example.test/sign-in',
			}),
		).toBe('https://accounts.example.test');
	});

	it.each([['http://stream.keepr.digital'], ['https://localhost'], ['https://keepr.digital']])(
		'is refused for %s rather than guessed',
		(origin) => {
			expect(() => keeprAccountsOriginOf(origin)).toThrow(
				expect.objectContaining({ code: 'harness-operator-unavailable' }),
			);
		},
	);
});

describe('opening the Session a run works under', () => {
	const signedIn = (cookies: string[], status = 200) =>
		vi.fn<typeof fetch>(async () => {
			const headers = new Headers();
			for (const cookie of cookies) headers.append('set-cookie', cookie);
			return new Response(null, { status, headers });
		});

	it('sends a local run no credential and makes no request', async () => {
		const fetchRequest = signedIn([]);

		expect(
			await openOperatorSession('http://127.0.0.1:8787', { env: CREDENTIALS, fetchRequest }),
		).toEqual([]);
		expect(fetchRequest).not.toHaveBeenCalled();
	});

	// A write to Keepr Accounts' sign-in is admitted only from Keepr Accounts
	// itself, and the credentials go nowhere else.
	it('signs a deployed run in at Keepr Accounts, as a page of Keepr Accounts would', async () => {
		const fetchRequest = signedIn([
			'__Secure-session=abc.def; Domain=keepr-staging.digital; Path=/; HttpOnly; Secure',
			'malformed',
		]);

		const cookies = await openOperatorSession('https://stream.keepr-staging.digital', {
			deployed: true,
			env: CREDENTIALS,
			fetchRequest,
		});

		expect(cookies).toEqual(['__Secure-session=abc.def']);
		expect(fetchRequest).toHaveBeenCalledOnce();
		const [url, init] = fetchRequest.mock.calls[0]!;
		expect(url).toBe('https://accounts.keepr-staging.digital/api/auth/sign-in/email');
		expect(new Headers(init?.headers).get('origin')).toBe('https://accounts.keepr-staging.digital');
		expect(JSON.parse(String(init?.body))).toEqual({
			email: 'ops@keepr.digital',
			password: 'their-password',
		});
	});

	it.each([
		['Keepr Accounts refuses the credentials', signedIn([], 401), { step: 'sign-in', actual: 401 }],
		[
			'it answers with no Session cookie',
			signedIn([]),
			{ step: 'sign-in', reason: 'no session cookie' },
		],
	])('stops a deployed run when %s', async (_case, fetchRequest, detail) => {
		await expect(
			openOperatorSession('https://stream.keepr.digital', {
				deployed: true,
				env: CREDENTIALS,
				fetchRequest,
			}),
		).rejects.toMatchObject({ code: 'harness-operator-unavailable', detail });
	});

	it('asks a local installation as nobody with the cookie its Accounts Stand-in reads', () => {
		expect(LOCAL_SIGNED_OUT_COOKIE).toBe('keepr-stand-in=signed-out');
	});
});

describe('whether an origin is a server on this machine', () => {
	it.each([
		'http://127.0.0.1:8787',
		'http://localhost:3000',
		'http://[::1]:8787',
		'http://0.0.0.0:8787',
	])('says yes to %s', (origin) => {
		expect(isLoopbackOrigin(origin)).toBe(true);
	});

	it.each([
		'https://stream.keepr.digital',
		'https://127.0.0.1.evil.example',
		'https://localhost.evil.example',
		'not-a-url',
		'',
	])('says no to %j, including a host that only looks local', (origin) => {
		expect(isLoopbackOrigin(origin)).toBe(false);
	});
});
