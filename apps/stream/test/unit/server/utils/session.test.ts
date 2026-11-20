import { beforeEach, describe, expect, it } from 'vitest';
import {
	A_MEMBER,
	AN_OUTSIDER,
	type Asker,
	keeprAccountsBinding,
	SIGNED_OUT,
	stubServerGlobals,
	workerRequest,
} from '~~/test/helpers/keeprAccounts';

/**
 * Who a request belongs to, as Stream Keepr reads it (ADR-0141): from an
 * Identity Proof and nothing else. The Accounts Stand-in answers as Keepr
 * Accounts behind the Worker's binding; everything else is the real reading.
 */

stubServerGlobals();

const accounts = keeprAccountsBinding();
const {
	optionalBrowserSessionId,
	optionalIdentity,
	requestIdentity,
	requireBrowserSessionId,
	requireLeaseHolder,
	requireUserId,
} = await import('~~/server/utils/session');

const UNREACHABLE = {
	KEEPR_ACCOUNTS: {
		fetch: async () => {
			throw new Error('connection lost');
		},
	},
};

function request(as: Asker, env: Record<string, unknown> = { KEEPR_ACCOUNTS: accounts }) {
	return workerRequest({ as, env });
}

/** The status a reading refused with, or what it answered. */
async function statusOf(reading: Promise<unknown>): Promise<unknown> {
	return await reading.catch((refusal: { statusCode: number }) => refusal.statusCode);
}

beforeEach(() => {
	accounts.asked.length = 0;
});

describe('requestIdentity', () => {
	it('answers the User, Session and App role the Identity Proof names', async () => {
		expect(await requestIdentity(request(A_MEMBER))).toMatchObject({
			user: { id: 'ada', name: 'Ada' },
			sessionId: 'ada-session',
			appRole: 'member',
		});
	});

	// ADR-0141: Keepr Accounts reads the first session cookie it is sent, so the
	// one Stream Keepr's former sign-in left is out of the request before it is asked.
	it("asks Keepr Accounts without the cookie of Stream Keepr's former sign-in", async () => {
		const name = '__Secure-better-auth.session_token';
		const event = request(A_MEMBER);
		event.node.req.headers.cookie = `${name}=retired; ${event.node.req.headers.cookie}; ${name}=accounts`;
		accounts.askedWith.length = 0;

		await requestIdentity(event);

		expect(accounts.askedWith[0]).not.toContain(`${name}=retired`);
		expect(accounts.askedWith[0]).toContain(`${name}=accounts`);
	});

	it('answers nobody for a signed-out visitor, leaving the refusal to its caller', async () => {
		expect(await requestIdentity(request(SIGNED_OUT))).toBeNull();
	});

	// No caller can hold an Identity with no App access: it is refused where it is read.
	it('refuses a User with no App access to Stream Keepr', async () => {
		await expect(requestIdentity(request(AN_OUTSIDER))).rejects.toMatchObject({
			statusCode: 403,
			data: { code: 'NO_APP_ACCESS' },
		});
	});

	// Nothing a request carries stands in for an Identity Proof.
	it.each([
		['a header naming a User', { 'x-user-id': 'ada', authorization: 'Bearer ada' }],
		['a cookie Keepr Accounts never issued', { cookie: 'session=ada; better=1' }],
	])('is not told who a request belongs to by %s', async (_case, headers) => {
		const event = workerRequest({
			as: SIGNED_OUT,
			headers,
			env: {
				KEEPR_ACCOUNTS: { fetch: async () => new Response(null, { status: 401 }) },
			},
		});

		expect(await requestIdentity(event)).toBeNull();
	});

	it('asks Keepr Accounts once for a request, however often the request asks', async () => {
		const event = request({ user: 'asked-once' });

		const answers = await Promise.all([
			requestIdentity(event),
			requireUserId(event),
			requireBrowserSessionId(event),
			requestIdentity(event),
		]);

		expect(answers[1]).toBe('asked-once');
		expect(accounts.asked.filter((path) => path === '/api/auth/token')).toHaveLength(1);
	});
});

describe('optionalIdentity, for a route another credential may admit', () => {
	it('answers a User with App access', async () => {
		expect(await optionalIdentity(request(A_MEMBER))).toMatchObject({ user: { id: 'ada' } });
	});

	// It never admits anyone, and never takes a Screen Output down with Keepr Accounts.
	it.each([
		['a signed-out visitor', () => request(SIGNED_OUT)],
		['a User with no App access', () => request(AN_OUTSIDER)],
		[
			'anyone while Keepr Accounts cannot be reached',
			() => request({ user: 'cut-off' }, UNREACHABLE),
		],
		['anyone while Keepr Accounts is not bound', () => request({ user: 'unbound' }, {})],
	])('answers nobody for %s', async (_case, event) => {
		expect(await optionalIdentity(event())).toBeNull();
	});
});

describe('the identities a route asks for', () => {
	it.each([
		['the User', requireUserId, 'ada'],
		['the Session', requireBrowserSessionId, 'ada-session'],
		['the Session, where there may be none', optionalBrowserSessionId, 'ada-session'],
		[
			'the Session and its User, for a Graphics Authoring Lease',
			requireLeaseHolder,
			{ sessionId: 'ada-session', holderName: 'Ada' },
		],
	] as const)('answer %s', async (_case, identity, expected) => {
		expect(await identity(request(A_MEMBER))).toEqual(expected);
	});

	// Each is behind the Session boundary today; it fails closed the day it is not.
	it.each([
		['the User', requireUserId, 401],
		['the Session', requireBrowserSessionId, 401],
		['a lease holder', requireLeaseHolder, 401],
		['the Session, where there may be none', optionalBrowserSessionId, undefined],
	] as const)(
		'answer a signed-out visitor asking for %s: %s',
		async (_case, identity, expected) => {
			expect(await statusOf(identity(request(SIGNED_OUT)))).toBe(expected);
		},
	);

	it('refuse while Keepr Accounts cannot be reached, 503', async () => {
		expect(await statusOf(requireUserId(request({ user: 'cut-off-too' }, UNREACHABLE)))).toBe(503);
	});
});
