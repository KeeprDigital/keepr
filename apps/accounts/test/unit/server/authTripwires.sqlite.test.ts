import type { TestAccounts } from '~~/test/helpers/keeprAccounts';
import { afterEach, describe, expect, it } from 'vitest';
import {
	createTestAccounts,
	fakeBreachedPasswordService,
	LOCAL_HOST,
	PASSWORD,
	PRODUCTION_HOST,
	sessionSetCookie,
	STAGING_HOST,
} from '~~/test/helpers/keeprAccounts';

/**
 * Library behaviour that depends on the environment, pinned so a Better Auth bump
 * that changes it fails here (ADR-0012, ADR-0112). The suite runs under
 * `NODE_ENV=test`, where each default below differs from a deployed Worker's, so
 * each row passes only because Keepr Accounts states the option.
 */

const EMAIL = 'tripwire@keepr.digital';
/** Addresses from RFC 5737's documentation networks. */
const CLIENT = '203.0.113.7';
const OTHER_CLIENT = '198.51.100.8';

const opened: TestAccounts[] = [];

async function accountsOn(options: Parameters<typeof createTestAccounts>[0] = {}) {
	fakeBreachedPasswordService();
	const accounts = await createTestAccounts(options);
	opened.push(accounts);
	return accounts;
}

async function withUser(options: Parameters<typeof createTestAccounts>[0] = {}) {
	const accounts = await accountsOn(options);
	await accounts.createUser(EMAIL);
	return accounts;
}

afterEach(async () => {
	for (const accounts of opened.splice(0)) await accounts.harness.close();
});

function signIn(
	accounts: TestAccounts,
	headers: Record<string, string> = {},
	password = PASSWORD,
	host?: string,
) {
	return accounts.send('/sign-in/email', { body: { email: EMAIL, password }, headers, host });
}

describe('the origin check', () => {
	it.each([
		['locally', LOCAL_HOST],
		['in production', PRODUCTION_HOST],
		['in staging', STAGING_HOST],
	])('admits a sign-in from a page of Keepr Accounts %s', async (_case, host) => {
		expect((await signIn(await withUser({ host }))).status).toBe(200);
	});

	it.each([
		['a page of an App', { origin: 'https://stream.keepr.digital' }, 'INVALID_ORIGIN'],
		['another site', { origin: 'https://elsewhere.example' }, 'INVALID_ORIGIN'],
		[
			'a request carrying a Session and no origin',
			{ origin: '', cookie: 'better-auth.session_token=stale' },
			'MISSING_OR_NULL_ORIGIN',
		],
	])('refuses a sign-in from %s', async (_case, headers, code) => {
		const response = await signIn(await withUser(), headers);

		expect(response.status).toBe(403);
		expect(await response.json()).toMatchObject({ code });
	});

	it('refuses a host Keepr Accounts does not answer on', async () => {
		const response = await signIn(
			await withUser(),
			{},
			PASSWORD,
			'keepr-accounts.example.workers.dev',
		);

		expect(response.status).toBe(403);
		expect(await response.json()).toMatchObject({ code: 'INVALID_ORIGIN' });
	});
});

describe('the session cookie', () => {
	it.each([
		['production', PRODUCTION_HOST, ['domain=keepr.digital']],
		['staging', STAGING_HOST, ['domain=keepr-staging.digital']],
		['development', LOCAL_HOST, []],
	])('in %s is set on %s with %j', async (_case, host, domain) => {
		const cookie = sessionSetCookie(await signIn(await withUser({ host })));

		expect(cookie!.attributes.filter((attribute) => attribute.startsWith('domain='))).toEqual(
			domain,
		);
	});

	it('is __Secure- prefixed, Secure, HttpOnly and Lax outside the dev server, even over http', async () => {
		const cookie = sessionSetCookie(await signIn(await withUser({ host: LOCAL_HOST })));

		expect(cookie!.name).toBe('__Secure-better-auth.session_token');
		expect(cookie!.attributes).toEqual(
			expect.arrayContaining(['secure', 'httponly', 'samesite=lax', 'path=/']),
		);
	});
});

describe('the sign-in rate limit', () => {
	async function exhaust(accounts: TestAccounts, client: string) {
		for (let attempt = 0; attempt < 3; attempt++)
			expect((await signIn(accounts, { 'cf-connecting-ip': client }, 'wrong')).status).toBe(401);
	}

	it("refuses a client's fourth attempt within ten seconds, the right password included", async () => {
		const accounts = await withUser();
		await exhaust(accounts, CLIENT);

		const refused = await signIn(accounts, { 'cf-connecting-ip': CLIENT });

		expect(refused.status).toBe(429);
		expect(Number(refused.headers.get('x-retry-after'))).toBeGreaterThan(0);
	});

	it('still signs in another client', async () => {
		const accounts = await withUser();
		await exhaust(accounts, CLIENT);

		expect((await signIn(accounts, { 'cf-connecting-ip': OTHER_CLIENT })).status).toBe(200);
	});

	it('counts in the database, so every isolate over it shares one count', async () => {
		const first = await withUser();
		const second = await accountsOn({ harness: first.harness });
		await exhaust(first, CLIENT);

		expect((await signIn(second, { 'cf-connecting-ip': CLIENT })).status).toBe(429);
	});

	// The library's memory store is one map per process, which this row tells apart.
	it('is not shared with an instance over another database', async () => {
		await exhaust(await withUser(), CLIENT);

		expect((await signIn(await withUser(), { 'cf-connecting-ip': CLIENT })).status).toBe(200);
	});
});

describe('the client address', () => {
	async function sessionAddress(headers: Record<string, string>) {
		const accounts = await withUser();
		const cookie = sessionSetCookie(await signIn(accounts, headers))!;
		const response = await accounts.send('/get-session', {
			headers: { cookie: `${cookie.name}=${cookie.value}` },
		});
		return ((await response.json()) as { session: { ipAddress: string | null } }).session.ipAddress;
	}

	it.each([
		["Cloudflare's header", { 'cf-connecting-ip': CLIENT }, CLIENT],
		[
			"Cloudflare's header over a caller's forwarded address",
			{ 'cf-connecting-ip': CLIENT, 'x-forwarded-for': OTHER_CLIENT },
			CLIENT,
		],
		// A header-less caller is loopback under test: the accepted residual (ADR-0012).
		[
			"a caller's forwarded address alone, which is ignored",
			{ 'x-forwarded-for': OTHER_CLIENT },
			'127.0.0.1',
		],
	])('is taken from %s', async (_case, headers, address) => {
		expect(await sessionAddress(headers)).toBe(address);
	});
});
