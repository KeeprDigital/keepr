import type { TestAccounts } from '~~/test/helpers/keeprAccounts';
import type { AccountsConnection } from '@keepr/nuxt-layer/server/utils/requestIdentity';
import { generateKeyPair, SignJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createIdentityResolver } from '@keepr/nuxt-layer/server/utils/requestIdentity';
import {
	IDENTITY_PROOF_AUDIENCE,
	KEEPR_ACCOUNTS_ORIGIN,
} from '@keepr/nuxt-layer/shared/utils/identityProof';
import { identityDatabase, schema } from '~~/server/db';
import { createTestAccounts, fakeBreachedPasswordService } from '~~/test/helpers/keeprAccounts';

// The shared layer's identity function, against a real Keepr Accounts minting real
// Identity Proofs. Only the Worker-to-Worker connection between them is faked.

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

let accounts: TestAccounts;
let userId: string;
let organizationId: string;
let cookie: string;
/** Whether the connection reaches Keepr Accounts, and what it has been asked. */
let reachable: boolean;
let proofRequests: number;
/** An Identity Proof to answer instead of the one Keepr Accounts mints. */
let forged: string | undefined;
/** While set, Keepr Accounts' Identity Proof waits for it. */
let held: Promise<void> | undefined;
let pending: Promise<unknown>[];

const connection: AccountsConnection = {
	async fetch(input, init) {
		if (!reachable)
			return new Response('Worker "keepr-accounts" not found. Make sure it is running locally.', {
				status: 503,
			});
		const request = new Request(input, init);
		if (new URL(request.url).pathname === '/api/auth/token') {
			proofRequests += 1;
			await held;
			if (forged) return Response.json({ token: forged });
		}
		return await accounts.auth.handler(request);
	},
};

const waitUntil = (promise: Promise<unknown>) => void pending.push(promise);

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-17T10:00:00Z') });
	fakeBreachedPasswordService();
	accounts = await createTestAccounts();
	userId = (await accounts.createUser('ada@keepr.digital')).id;
	organizationId = (
		await accounts.addMember(userId, 'keepr', { role: 'admin', apps: { stream: 'admin' } })
	).organizationId;
	cookie = await accounts.signIn('ada@keepr.digital');
	reachable = true;
	proofRequests = 0;
	forged = undefined;
	held = undefined;
	pending = [];
});

afterEach(async () => {
	vi.useRealTimers();
	await accounts.harness.close();
});

function later(ms: number) {
	vi.setSystemTime(Date.now() + ms);
}

describe('a valid Identity Proof', () => {
	it.each([
		['stream', 'admin'],
		['score', null],
	] as const)('resolves to the User, Organisation and App role in %s', async (app, appRole) => {
		const resolve = createIdentityResolver(app);

		const answer = await resolve({ cookie, accounts: connection, waitUntil });

		expect(answer).toMatchObject({
			kind: 'signed-in',
			identity: {
				user: { id: userId, email: 'ada@keepr.digital', name: 'ada' },
				organisation: { id: organizationId, role: 'admin' },
				appRole,
				keeprAdministrator: false,
			},
		});
	});
});

// Why an App takes a retired cookie of the session cookie's name out of a
// request before it asks (ADR-0141): Keepr Accounts reads the first it is sent.
describe("a request that carries another cookie of the session cookie's name", () => {
	const sessionCookieName = () => cookie.slice(0, cookie.indexOf('='));

	it('is signed out when the other one comes first', async () => {
		const resolve = createIdentityResolver('stream');

		const answer = await resolve({
			cookie: `${sessionCookieName()}=retired.signature; ${cookie}`,
			accounts: connection,
			waitUntil,
		});

		expect(answer.kind).toBe('signed-out');
	});

	it("is signed in when the Session's own comes first", async () => {
		const resolve = createIdentityResolver('stream');

		const answer = await resolve({
			cookie: `${cookie}; ${sessionCookieName()}=retired.signature`,
			accounts: connection,
			waitUntil,
		});

		expect(answer.kind).toBe('signed-in');
	});
});

it('resolves an Identity Proof signed by a key published since the App last read the keys', async () => {
	const resolve = createIdentityResolver('stream');
	await resolve({ cookie, accounts: connection, waitUntil });
	// Keepr Accounts starts again with a new key, as after a rotation.
	await identityDatabase(accounts.harness.database).delete(schema.jwks);
	const other = await accounts.createUser('grace@keepr.digital');
	await accounts.addMember(other.id, 'keepr', { apps: { stream: 'member' } });

	const answer = await resolve({
		cookie: await accounts.signIn('grace@keepr.digital'),
		accounts: connection,
		waitUntil,
	});

	expect(answer).toMatchObject({ kind: 'signed-in', identity: { appRole: 'member' } });
});

describe('an Identity Proof that cannot be trusted', () => {
	async function signedByKeeprAccounts(overrides: Record<string, unknown>) {
		const { token } = await accounts.auth.api.signJWT({
			body: {
				payload: { sub: userId, sid: 'a-session', iat: Math.floor(Date.now() / 1000) - 60 },
				// Replaces the add-on's whole `jwt` block, so the real values are restated.
				overrideOptions: {
					jwt: { issuer: KEEPR_ACCOUNTS_ORIGIN, audience: IDENTITY_PROOF_AUDIENCE, ...overrides },
				},
			},
		});
		return token;
	}

	it.each([
		[
			'expired',
			() => signedByKeeprAccounts({ expirationTime: Math.floor(Date.now() / 1000) - 1 }),
			'ERR_JWT_EXPIRED',
		],
		[
			'for another issuer',
			() => signedByKeeprAccounts({ issuer: 'https://evil.example' }),
			'"iss" claim',
		],
		[
			'for another audience',
			() => signedByKeeprAccounts({ audience: 'https://other.example' }),
			'"aud" claim',
		],
		[
			'signed by a key Keepr Accounts never published',
			async () => {
				const { privateKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
				return await new SignJWT({ sid: 's', email: 'mallory@evil.example' })
					.setProtectedHeader({ alg: 'EdDSA', kid: 'not-a-published-key' })
					.setSubject(userId)
					.setIssuer('https://accounts.keepr.digital')
					.setAudience('https://keepr.digital')
					.setIssuedAt()
					.setExpirationTime('5m')
					.sign(privateKey);
			},
			'ERR_JWKS_NO_MATCHING_KEY',
		],
	])('is refused when %s', async (_case, forge, code) => {
		forged = await forge();

		const answer = await createIdentityResolver('stream')({
			cookie,
			accounts: connection,
			waitUntil,
		});

		expect(answer).toMatchObject({ kind: 'unavailable' });
		expect((answer as { reason: string }).reason).toContain(code);
	});
});

describe('a cached Identity Proof', () => {
	it('is reused until it expires', async () => {
		const resolve = createIdentityResolver('stream');
		await resolve({ cookie, accounts: connection, waitUntil });

		later(2 * MINUTE_MS);
		await resolve({ cookie, accounts: connection, waitUntil });
		await Promise.all(pending);
		expect(proofRequests).toBe(1);

		later(3 * MINUTE_MS);
		await resolve({ cookie, accounts: connection, waitUntil });
		expect(proofRequests).toBe(2);
	});

	it('is refreshed in the background, answering at once from the cache', async () => {
		const resolve = createIdentityResolver('stream');
		await resolve({ cookie, accounts: connection, waitUntil });
		later(3 * MINUTE_MS);
		let release!: () => void;
		held = new Promise((resolve) => (release = resolve));

		const answer = await resolve({ cookie, accounts: connection, waitUntil });

		expect(answer.kind).toBe('signed-in');
		release();
		await Promise.all(pending);
		expect(proofRequests).toBe(2);
		// Good for five minutes from the refresh, not from the first proof.
		later(4 * MINUTE_MS);
		reachable = false;
		expect((await resolve({ cookie, accounts: connection, waitUntil })).kind).toBe('signed-in');
	});

	// An App's log names which, as the one of them that keeps a request waiting on Keepr Accounts.
	it.each([
		['asked, with none held', null, 'asked'],
		['cached, before half its life', 2 * MINUTE_MS, 'cached'],
		['refreshing, once half its life has passed', 3 * MINUTE_MS, 'refreshing'],
		['asked, once it has expired', 5 * MINUTE_MS + 1000, 'asked'],
	] as const)('says the answer was %s', async (_case, heldFor, proof) => {
		const resolve = createIdentityResolver('stream');
		if (heldFor !== null) {
			await resolve({ cookie, accounts: connection, waitUntil });
			later(heldFor);
		}

		const answer = await resolve({ cookie, accounts: connection, waitUntil });
		await Promise.all(pending);

		expect(answer).toMatchObject({ kind: 'signed-in', proof });
	});

	it.each([
		['is still accepted while Keepr Accounts is unreachable', 4 * MINUTE_MS, 'signed-in'],
		['is refused once expired with no answer', 5 * MINUTE_MS + 1000, 'unavailable'],
	])('%s', async (_case, after, kind) => {
		const resolve = createIdentityResolver('stream');
		await resolve({ cookie, accounts: connection, waitUntil });
		reachable = false;

		later(after);
		const answer = await resolve({ cookie, accounts: connection, waitUntil });
		await Promise.all(pending);

		expect(answer.kind).toBe(kind);
	});
});

it('refuses a request with no cached Identity Proof when Keepr Accounts does not answer', async () => {
	reachable = false;

	const answer = await createIdentityResolver('stream')({
		cookie,
		accounts: connection,
		waitUntil,
	});

	expect(answer).toMatchObject({
		kind: 'unavailable',
		reason: expect.stringContaining('keepr-accounts'),
	});
});

it('passes on a Session Keepr Accounts renewed', async () => {
	const resolve = createIdentityResolver('stream');
	await resolve({ cookie, accounts: connection, waitUntil });

	later(2 * DAY_MS);
	const answer = await resolve({ cookie, accounts: connection, waitUntil });

	expect(answer.setCookie).toEqual([
		expect.stringMatching(/better-auth\.session_token=.*Max-Age=604800/),
	]);
});

describe('within five minutes, a request stops resolving for', () => {
	it.each([
		[
			'an ended Session',
			async () => void (await accounts.send('/sign-out', { body: {}, headers: { cookie } })),
		],
		[
			'a disabled User',
			async () =>
				void (await (
					await accounts.auth.$context
				).internalAdapter.updateUser(userId, {
					banned: true,
				})),
		],
	])('%s', async (_case, revoke) => {
		const resolve = createIdentityResolver('stream');
		await resolve({ cookie, accounts: connection, waitUntil });

		await revoke();
		later(5 * MINUTE_MS);
		const answer = await resolve({ cookie, accounts: connection, waitUntil });

		expect(answer.kind).toBe('signed-out');
	});
});
