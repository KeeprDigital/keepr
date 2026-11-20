import type { JWK } from 'jose';
import type { AccountsConnection } from '../../../../server/utils/requestIdentity';
import type { Identity } from '../../../../shared/utils/identityProof';
import { createApp, eventHandler, toWebHandler } from 'h3';
import {
	base64url,
	exportJWK,
	generateKeyPair,
	type JWTPayload,
	SignJWT,
	UnsecuredJWT,
} from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	createIdentityResolver,
	requireAppAccess,
	requireAppRole,
	resolveRequestIdentity,
} from '../../../../server/utils/requestIdentity';

// The verifier's home: the shared layer's identity function, asked through a
// fake of Keepr Accounts' binding that signs real Identity Proofs with keys it
// publishes, withdraws and rotates. Only the connection and the clock are faked.

const MINUTE_MS = 60 * 1000;
const ISSUER = 'https://accounts.keepr.digital';
const AUDIENCE = 'https://keepr.digital';
/** Keepr Accounts' session cookie, as a built Worker's browser sends it. */
const SESSION = '__Secure-better-auth.session_token';
const ADA = `${SESSION}=ada`;

interface SigningKey {
	kid: string;
	privateKey: CryptoKey;
	jwk: JWK;
}

async function signingKey(kid: string): Promise<SigningKey> {
	const { privateKey, publicKey } = await generateKeyPair('EdDSA', {
		crv: 'Ed25519',
		extractable: true,
	});
	return { kid, privateKey, jwk: { ...(await exportJWK(publicKey)), kid, alg: 'EdDSA' } };
}

/** The claims Keepr Accounts signs for `user`. */
function claimsOf(user: string, apps: Record<string, string> = { stream: 'member' }) {
	return {
		sid: `${user}-session`,
		email: `${user}@keepr.digital`,
		name: user,
		org: 'keepr',
		orgRole: 'owner',
		apps,
		keeprAdmin: true,
	};
}

async function signed(key: SigningKey, claims: JWTPayload, subject?: string) {
	const jwt = new SignJWT(claims)
		.setProtectedHeader({ alg: 'EdDSA', kid: key.kid })
		.setIssuer(ISSUER)
		.setAudience(AUDIENCE)
		.setIssuedAt()
		.setExpirationTime('5m');
	if (subject !== undefined) jwt.setSubject(subject);
	return await jwt.sign(key.privateKey);
}

/**
 * Keepr Accounts as the binding reaches it: an Identity Proof for a cookie
 * naming a User in its session cookie, 401 for any other. Each field is a
 * test's to change.
 */
interface FakeAccounts {
	published: SigningKey[];
	signer: SigningKey;
	/** What it answers a proof request with, in place of signing one. */
	answer: ((request: Request) => Promise<Response>) | undefined;
	apps: Record<string, string>;
	setCookie: string[];
	asked: Request[];
	proofAsks: () => Request[];
	connection: AccountsConnection;
}

function fakeAccounts(key: SigningKey): FakeAccounts {
	const accounts: FakeAccounts = {
		published: [key],
		signer: key,
		answer: undefined,
		apps: { stream: 'member' },
		setCookie: [],
		asked: [],
		proofAsks: () => accounts.asked.filter((request) => request.url.endsWith('/api/auth/token')),
		connection: {
			async fetch(input, init) {
				const request = new Request(input, init);
				accounts.asked.push(request);
				if (new URL(request.url).pathname === '/api/auth/jwks')
					return Response.json({ keys: accounts.published.map(({ jwk }) => jwk) });
				if (accounts.answer) return await accounts.answer(request);
				const user = new RegExp(`${SESSION}=([^;]+)`).exec(
					request.headers.get('cookie') ?? '',
				)?.[1];
				if (!user || user === 'nobody') return new Response(null, { status: 401 });
				return Response.json(
					{ token: await signed(accounts.signer, claimsOf(user, accounts.apps), user) },
					{ headers: accounts.setCookie.map((value): [string, string] => ['set-cookie', value]) },
				);
			},
		},
	};
	return accounts;
}

let key: SigningKey;
let accounts: FakeAccounts;
let pending: Promise<unknown>[];
const waitUntil = (promise: Promise<unknown>) => void pending.push(promise);

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-20T10:00:00Z') });
	key = await signingKey('k');
	accounts = fakeAccounts(key);
	pending = [];
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

function later(ms: number) {
	vi.setSystemTime(Date.now() + ms);
}

type Resolver = ReturnType<typeof createIdentityResolver<'stream'>>;

async function ask(resolve: Resolver, cookie: string = ADA, origin?: string) {
	const answer = await resolve({ cookie, accounts: accounts.connection, waitUntil, origin });
	await Promise.all(pending.splice(0));
	return answer;
}

const resolver = (options: Parameters<typeof createIdentityResolver>[1] = {}) =>
	createIdentityResolver('stream', { sharedStore: undefined, ...options });

describe('an Identity Proof that cannot be trusted is refused', () => {
	/** A key Keepr Accounts never published, under the published key's id. */
	const impostor = async () => ({ ...(await signingKey('k')), kid: 'k' });

	it.each([
		[
			'with no algorithm',
			async () =>
				new UnsecuredJWT(claimsOf('ada'))
					.setSubject('ada')
					.setIssuer(ISSUER)
					.setAudience(AUDIENCE)
					.setIssuedAt()
					.setExpirationTime('5m')
					.encode(),
		],
		[
			'signed symmetrically with the public key',
			async () =>
				await new SignJWT(claimsOf('ada'))
					.setProtectedHeader({ alg: 'HS256', kid: 'k' })
					.setSubject('ada')
					.setIssuer(ISSUER)
					.setAudience(AUDIENCE)
					.setIssuedAt()
					.setExpirationTime('5m')
					.sign(base64url.decode(key.jwk.x!)),
		],
		[
			"with the published key's id and a wrong signature",
			async () => await signed(await impostor(), claimsOf('ada'), 'ada'),
		],
		['with no subject', async () => await signed(key, claimsOf('ada'))],
		[
			'with no Session id',
			async () => {
				const { sid: _sid, ...claims } = claimsOf('ada');
				return await signed(key, claims, 'ada');
			},
		],
		[
			'not yet valid',
			async () =>
				await new SignJWT(claimsOf('ada'))
					.setProtectedHeader({ alg: 'EdDSA', kid: 'k' })
					.setSubject('ada')
					.setIssuer(ISSUER)
					.setAudience(AUDIENCE)
					.setIssuedAt()
					.setNotBefore('1m')
					.setExpirationTime('5m')
					.sign(key.privateKey),
		],
	])('%s', async (_case, forge) => {
		const token = await forge();
		accounts.answer = async () => Response.json({ token });

		expect(await ask(resolver())).toMatchObject({ kind: 'unavailable' });
	});

	it('signed by a key Keepr Accounts has withdrawn', async () => {
		const resolve = resolver();
		await ask(resolve);
		// Keepr Accounts rotates and withdraws the key, which still signs elsewhere.
		accounts.published = [await signingKey('k2')];
		later(5 * MINUTE_MS + 1000);

		expect(await ask(resolve, `${SESSION}=grace`)).toMatchObject({ kind: 'unavailable' });
	});
});

it('verifies an Identity Proof signed by a key Keepr Accounts published since the App read its keys', async () => {
	const resolve = resolver();
	await ask(resolve);
	accounts.signer = await signingKey('k2');
	accounts.published = [key, accounts.signer];

	expect(await ask(resolve, `${SESSION}=grace`)).toMatchObject({ kind: 'signed-in' });
});

describe('what Keepr Accounts is asked', () => {
	it('carries only its own cookies', async () => {
		await ask(
			resolver(),
			`theme=dark; ${ADA}; better-auth.session_token=dev; keepr-stand-in=user=ada; _ga=1`,
		);

		expect(accounts.proofAsks().map((request) => request.headers.get('cookie'))).toEqual([
			`${ADA}; better-auth.session_token=dev; keepr-stand-in=user=ada`,
		]);
	});

	// The renewed session cookie Keepr Accounts sets is for the domain of the
	// host it was asked on, so each Environment's App asks its own.
	it.each([
		['production', 'https://stream.keepr.digital', 'accounts.keepr.digital'],
		['staging', 'https://stream.keepr-staging.digital', 'accounts.keepr-staging.digital'],
		['any other origin', 'http://localhost:3000', 'accounts.keepr.digital'],
		['no origin', undefined, 'accounts.keepr.digital'],
	])('is the Keepr Accounts of the App in %s', async (_case, origin, host) => {
		await ask(resolver(), ADA, origin);

		expect(new Set(accounts.asked.map((request) => new URL(request.url).host))).toEqual(
			new Set([host]),
		);
	});
});

describe("the resolver's cache", () => {
	it('evicts the least recently asked once it holds its size', async () => {
		const resolve = resolver({ cacheSize: 2 });
		for (const user of ['ada', 'grace', 'ada', 'linus']) await ask(resolve, `${SESSION}=${user}`);
		accounts.asked.length = 0;

		await ask(resolve, `${SESSION}=ada`);
		await ask(resolve, `${SESSION}=grace`);

		expect(accounts.proofAsks()).toHaveLength(1);
		expect(accounts.proofAsks()[0]!.headers.get('cookie')).toBe(`${SESSION}=grace`);
	});

	it('answers a signed-out cookie again without asking, briefly', async () => {
		const resolve = resolver();
		const nobody = `${SESSION}=nobody`;

		expect(await ask(resolve, nobody)).toMatchObject({ kind: 'signed-out' });
		expect(await ask(resolve, nobody)).toMatchObject({ kind: 'signed-out' });
		expect(accounts.proofAsks()).toHaveLength(1);

		later(MINUTE_MS);
		await ask(resolve, nobody);
		expect(accounts.proofAsks()).toHaveLength(2);
	});

	it('gives up on a refresh that never returns, and refreshes again', async () => {
		const resolve = resolver({ askTimeoutMs: 20 });
		await ask(resolve);
		later(3 * MINUTE_MS);
		accounts.answer = () => new Promise<Response>(() => {});

		expect(await ask(resolve)).toMatchObject({ kind: 'signed-in', proof: 'refreshing' });
		expect(await ask(resolve)).toMatchObject({ kind: 'signed-in', proof: 'refreshing' });
		expect(accounts.proofAsks()).toHaveLength(3);
	});

	it('refuses a request whose ask never returns', async () => {
		accounts.answer = () => new Promise<Response>(() => {});

		expect(await ask(resolver({ askTimeoutMs: 20 }))).toMatchObject({ kind: 'unavailable' });
	});

	it('hands renewed cookies a background refresh was given to exactly one answer', async () => {
		const resolve = resolver();
		await ask(resolve);
		later(3 * MINUTE_MS);
		accounts.setCookie = [`${SESSION}=ada; Max-Age=604800`];

		expect((await ask(resolve)).setCookie).toEqual([]);
		expect((await ask(resolve)).setCookie).toEqual([`${SESSION}=ada; Max-Age=604800`]);
		expect((await ask(resolve)).setCookie).toEqual([]);
	});

	it('answers with no App access once a background refresh says so', async () => {
		const resolve = resolver();
		await ask(resolve);
		later(3 * MINUTE_MS);
		accounts.apps = {};

		await ask(resolve);

		expect(await ask(resolve)).toMatchObject({ kind: 'signed-in', identity: { appRole: null } });
	});
});

/** An App's route that answers who the request belongs to, or the refusal it was given. */
async function whoAmI(cookie: string, env: Record<string, unknown>) {
	const app = createApp();
	app.use(
		eventHandler(async (event) => {
			event.context.cloudflare = { env };
			try {
				return await resolveRequestIdentity(event, 'stream', resolver());
			} catch (error) {
				const { statusCode, message, data } = error as {
					statusCode: number;
					message: string;
					data?: { code?: string };
				};
				return { refused: statusCode, message, code: data?.code };
			}
		}),
	);
	const response = await toWebHandler(app)(
		new Request('https://stream.keepr.digital/api/identity', { headers: { cookie } }),
	);
	return { body: await response.json(), setCookie: response.headers.getSetCookie() };
}

describe('resolveRequestIdentity', () => {
	it('asks over the KEEPR_ACCOUNTS binding and passes the renewed cookie back', async () => {
		accounts.setCookie = [`${SESSION}=ada; Max-Age=604800`];

		const { body, setCookie } = await whoAmI(ADA, { KEEPR_ACCOUNTS: accounts.connection });

		expect(body).toMatchObject({ user: { id: 'ada' }, appRole: 'member' });
		expect(setCookie).toEqual([`${SESSION}=ada; Max-Age=604800`]);
	});

	it.each([
		['a signed-out visitor', `${SESSION}=nobody`, true, 401, 'SIGNED_OUT'],
		['an App with no binding, naming it', ADA, false, 503, 'KEEPR_ACCOUNTS is not bound'],
	])('refuses %s', async (_case, cookie, bound, refused, says) => {
		const { body } = await whoAmI(cookie, bound ? { KEEPR_ACCOUNTS: accounts.connection } : {});

		expect(body.refused).toBe(refused);
		expect(JSON.stringify(body)).toContain(says);
	});

	// Why is the operator's to read, in the log; the caller is told one sentence.
	it.each([
		[
			'nothing is registered under the service name',
			async () =>
				new Response('Worker "keepr-accounts" not found. Make sure it is running locally.', {
					status: 503,
				}),
			'pnpm accounts:stand-in',
		],
		['Keepr Accounts answers an error', async () => new Response(null, { status: 500 }), '500'],
		[
			'its Identity Proof does not verify',
			async () => Response.json({ token: await signed(key, claimsOf('ada')) }),
			'ERR_JWT_CLAIM_VALIDATION_FAILED',
		],
	])('refuses with one sentence when %s, logging why', async (_case, answer, why) => {
		const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
		accounts.answer = answer;

		const { body } = await whoAmI(ADA, { KEEPR_ACCOUNTS: accounts.connection });

		expect(body).toMatchObject({
			refused: 503,
			message: 'Keepr Accounts could not be asked who you are. Try again in a moment.',
		});
		expect(log.mock.calls.flat().join('\n')).toContain(why);
	});
});

describe('the access helpers', () => {
	const identity = (appRole: 'member' | 'admin' | null): Identity<'stream'> => ({
		app: 'stream',
		user: { id: 'ada', email: 'ada@keepr.digital', name: 'Ada' },
		sessionId: 's',
		organisation: { id: 'keepr', role: 'owner' },
		appRole,
		keeprAdministrator: true,
	});

	it.each([
		[
			"no App access, a Keepr Administrator's included",
			() => requireAppAccess(identity(null)),
			'NO_APP_ACCESS',
		],
		[
			'a lower App role than the one required',
			() => requireAppRole(identity('member'), 'admin'),
			'APP_ROLE_REQUIRED',
		],
	])('refuse %s, 403', (_case, require, code) => {
		expect(require).toThrow(
			expect.objectContaining({ statusCode: 403, data: expect.objectContaining({ code }) }),
		);
	});

	it.each([
		['the role itself', 'member', 'member'],
		['a higher role', 'admin', 'member'],
	] as const)('admit %s', (_case, held, required) => {
		expect(() => requireAppRole(identity(held), required)).not.toThrow();
	});
});
