import type { H3Event } from 'h3';
import type { JSONWebKeySet, JWTPayload } from 'jose';
import type { AppId, AppRole } from '../../shared/utils/appRegistry';
import type { Identity } from '../../shared/utils/identityProof';
import { appendResponseHeader, createError, getRequestHeader } from 'h3';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { APP_REGISTRY } from '../../shared/utils/appRegistry';
import {
	IDENTITY_PROOF_ALGORITHM,
	IDENTITY_PROOF_AUDIENCE,
	IDENTITY_PROOF_PATH,
	identityFromClaims,
	KEEPR_ACCOUNTS_BINDING,
	KEEPR_ACCOUNTS_ORIGIN,
	KEEPR_ACCOUNTS_SERVICE,
	PUBLIC_KEYS_PATH,
} from '../../shared/utils/identityProof';
import { ServiceConfigurationError, TemporarilyUnavailableError } from './errors';

/**
 * Who a request belongs to, asked of Keepr Accounts over the Worker-to-Worker
 * connection and checked here against its published keys (ADR-0112, ADR-0113).
 * An App calls `resolveRequestIdentity` from its own routes and middleware; the
 * layer registers neither.
 */

/** The connection to Keepr Accounts: in a Worker, the service binding. */
export interface AccountsConnection {
	fetch: (input: string, init?: RequestInit) => Promise<Response>;
}

/** What Keepr Accounts said about one request, and the cookies to pass to the browser. */
export type IdentityAnswer<App extends AppId> =
	| { kind: 'signed-in'; identity: Identity<App>; setCookie: string[] }
	| { kind: 'signed-out'; setCookie: string[] }
	/** No Identity Proof this App can trust, and no answer that says why: refused. */
	| { kind: 'unavailable'; reason: string; setCookie: string[] };

interface CachedProof<App extends AppId> {
	identity: Identity<App>;
	expiresAt: number;
	refreshAfter: number;
	refreshing: boolean;
	/** Cookies a background refresh was handed, passed on with the next answer. */
	renewedCookies: string[];
}

type Verified<App extends AppId> =
	| { kind: 'signed-in'; identity: Identity<App>; expiresAt: number; refreshAfter: number }
	| { kind: 'refused'; reason: string };

/** What the local dev registry answers for a service with nothing registered under its name. */
const NOTHING_REGISTERED = /Worker ".*" not found/;

/**
 * A resolver for one App, holding the Identity Proofs and keys it has verified.
 * A cached Identity Proof answers until it expires, is refreshed in the
 * background once half its life has passed, and keeps answering while Keepr
 * Accounts is unreachable. Past expiry, only a fresh answer does.
 */
export function createIdentityResolver<App extends AppId>(
	app: App,
	{ cacheSize = 1000 }: { cacheSize?: number } = {},
) {
	const proofs = new Map<string, CachedProof<App>>();
	let keys: ReturnType<typeof createLocalJWKSet> | undefined;

	async function publicKeys(accounts: AccountsConnection, refetch: boolean) {
		if (!keys || refetch) {
			const response = await accounts.fetch(`${KEEPR_ACCOUNTS_ORIGIN}${PUBLIC_KEYS_PATH}`);
			if (!response.ok) throw new Error(`its keys answered ${response.status}`);
			keys = createLocalJWKSet((await response.json()) as JSONWebKeySet);
		}
		return keys;
	}

	async function verify(
		accounts: AccountsConnection,
		token: string,
		refetched = false,
	): Promise<Verified<App>> {
		let payload: JWTPayload;
		try {
			({ payload } = await jwtVerify(token, await publicKeys(accounts, refetched), {
				issuer: KEEPR_ACCOUNTS_ORIGIN,
				audience: IDENTITY_PROOF_AUDIENCE,
				algorithms: [IDENTITY_PROOF_ALGORITHM],
				requiredClaims: ['sub', 'sid', 'iat', 'exp'],
			}));
		} catch (error) {
			const code = (error as { code?: unknown }).code;
			// An unknown key may be a new one: Keepr Accounts rotated, or the
			// Accounts Stand-in restarted. Its keys are fetched again, once.
			if (code === 'ERR_JWKS_NO_MATCHING_KEY' && !refetched) return verify(accounts, token, true);
			return {
				kind: 'refused',
				reason: `its Identity Proof could not be verified (${typeof code === 'string' ? `${code}: ` : ''}${(error as Error).message})`,
			};
		}
		const issuedAt = payload.iat! * 1000;
		const expiresAt = payload.exp! * 1000;
		return {
			kind: 'signed-in',
			identity: identityFromClaims(app, payload),
			expiresAt,
			refreshAfter: issuedAt + (expiresAt - issuedAt) / 2,
		};
	}

	/** Asks Keepr Accounts for a fresh Identity Proof for `cookie`, and checks it. */
	async function ask(
		accounts: AccountsConnection,
		cookie: string,
	): Promise<{ answer: IdentityAnswer<App>; cached?: CachedProof<App> }> {
		const unavailable = (reason: string, setCookie: string[] = []) => ({
			answer: { kind: 'unavailable' as const, reason, setCookie },
		});
		let response: Response;
		try {
			response = await accounts.fetch(`${KEEPR_ACCOUNTS_ORIGIN}${IDENTITY_PROOF_PATH}`, {
				headers: cookie ? { cookie } : {},
			});
		} catch (error) {
			return unavailable(`the connection failed (${(error as Error).message})`);
		}
		const setCookie = response.headers.getSetCookie();
		if (response.status === 401) return { answer: { kind: 'signed-out', setCookie } };
		if (!response.ok) {
			const body = await response.text().catch(() => '');
			return unavailable(
				NOTHING_REGISTERED.test(body)
					? `no Worker is registered locally as "${KEEPR_ACCOUNTS_SERVICE}". Start the Accounts Stand-in beside this App (\`pnpm accounts:stand-in\`), or Keepr Accounts itself (apps/accounts/README.md)`
					: `it answered ${response.status}`,
				setCookie,
			);
		}
		let token: unknown;
		try {
			({ token } = (await response.json()) as { token?: unknown });
		} catch {
			return unavailable('it answered something other than an Identity Proof', setCookie);
		}
		if (typeof token !== 'string')
			return unavailable('it answered something other than an Identity Proof', setCookie);
		let verified: Verified<App>;
		try {
			verified = await verify(accounts, token);
		} catch (error) {
			return unavailable(`its keys could not be read (${(error as Error).message})`, setCookie);
		}
		if (verified.kind === 'refused') return unavailable(verified.reason, setCookie);
		return {
			answer: { kind: 'signed-in', identity: verified.identity, setCookie },
			cached: {
				identity: verified.identity,
				expiresAt: verified.expiresAt,
				refreshAfter: verified.refreshAfter,
				refreshing: false,
				renewedCookies: [],
			},
		};
	}

	function remember(cookie: string, proof: CachedProof<App>) {
		proofs.delete(cookie);
		proofs.set(cookie, proof);
		for (const oldest of proofs.keys()) {
			if (proofs.size <= cacheSize) break;
			proofs.delete(oldest);
		}
	}

	async function refresh(accounts: AccountsConnection, cookie: string, proof: CachedProof<App>) {
		const { answer, cached } = await ask(accounts, cookie);
		if (cached) remember(cookie, { ...cached, renewedCookies: answer.setCookie });
		else if (answer.kind === 'signed-out') proofs.delete(cookie);
		// Unreachable: the cached proof keeps answering until it expires.
		else proof.refreshing = false;
	}

	/**
	 * Who the request carrying `cookie` belongs to. `waitUntil` keeps a background
	 * refresh alive past the response, as a Worker's `ctx.waitUntil` does.
	 */
	return async function resolve({
		cookie = '',
		accounts,
		waitUntil,
	}: {
		cookie?: string;
		accounts: AccountsConnection;
		waitUntil?: (promise: Promise<unknown>) => void;
	}): Promise<IdentityAnswer<App>> {
		const now = Date.now();
		const proof = proofs.get(cookie);
		if (proof && now < proof.expiresAt) {
			if (now >= proof.refreshAfter && !proof.refreshing) {
				proof.refreshing = true;
				const refreshed = refresh(accounts, cookie, proof);
				if (waitUntil) waitUntil(refreshed);
			}
			const setCookie = proof.renewedCookies;
			proof.renewedCookies = [];
			return { kind: 'signed-in', identity: proof.identity, setCookie };
		}
		proofs.delete(cookie);
		const { answer, cached } = await ask(accounts, cookie);
		if (cached) remember(cookie, cached);
		return answer;
	};
}

export type IdentityResolver<App extends AppId> = ReturnType<typeof createIdentityResolver<App>>;

const resolvers = new Map<AppId, IdentityResolver<AppId>>();

function resolverFor<App extends AppId>(app: App): IdentityResolver<App> {
	let resolver = resolvers.get(app);
	if (!resolver) {
		resolver = createIdentityResolver(app);
		resolvers.set(app, resolver);
	}
	return resolver as unknown as IdentityResolver<App>;
}

/** The connection to Keepr Accounts a Worker request was given, as its service binding. */
function accountsConnectionOf(event: H3Event): AccountsConnection {
	const env = (event.context as { cloudflare?: { env?: Record<string, unknown> } }).cloudflare?.env;
	const binding = env?.[KEEPR_ACCOUNTS_BINDING] as AccountsConnection | undefined;
	if (!binding || typeof binding.fetch !== 'function')
		throw new ServiceConfigurationError(
			KEEPR_ACCOUNTS_BINDING,
			`is not bound to the "${KEEPR_ACCOUNTS_SERVICE}" service, so nobody can be recognised`,
		);
	return binding;
}

/** What keeps a background refresh alive past the response: Nitro's, else the Worker's own. */
function waitUntilOf(event: H3Event): ((promise: Promise<unknown>) => void) | undefined {
	const nitro = (event as { waitUntil?: (promise: Promise<unknown>) => void }).waitUntil;
	if (nitro) return nitro.bind(event);
	const worker = (
		event.context as { cloudflare?: { context?: { waitUntil?: (p: Promise<unknown>) => void } } }
	).cloudflare?.context;
	return worker?.waitUntil?.bind(worker);
}

/**
 * Who the request belongs to, as `app` sees them. An App's "who am I" route
 * answers with this, at `IDENTITY_PATH`. Passes any Session Keepr
 * Accounts renewed on to the browser. A signed-out visitor is refused 401; with
 * no Identity Proof to trust and no answer from Keepr Accounts, 503, naming why.
 */
export async function resolveRequestIdentity<App extends AppId>(
	event: H3Event,
	app: App,
	resolver: IdentityResolver<App> = resolverFor(app),
): Promise<Identity<App>> {
	const answer = await resolver({
		cookie: getRequestHeader(event, 'cookie'),
		accounts: accountsConnectionOf(event),
		waitUntil: (promise) => waitUntilOf(event)?.(promise),
	});
	for (const value of answer.setCookie) appendResponseHeader(event, 'set-cookie', value);
	if (answer.kind === 'signed-in') return answer.identity;
	if (answer.kind === 'signed-out')
		throw createError({
			statusCode: 401,
			message: 'Sign in to Keepr Accounts to continue.',
			data: { code: 'SIGNED_OUT' },
		});
	throw new TemporarilyUnavailableError(`Keepr Accounts did not answer: ${answer.reason}.`);
}

/** Refuses an Identity with no App access, 403, the same way in every App. */
export function requireAppAccess<App extends AppId>(
	identity: Identity<App>,
): asserts identity is Identity<App> & { appRole: AppRole<App> } {
	if (identity.appRole === null)
		throw createError({
			statusCode: 403,
			message: 'You have no access to this App. Ask an owner or admin of your Organisation.',
			data: { code: 'NO_APP_ACCESS' },
		});
}

/**
 * Refuses an Identity without `role` or a role above it in `app`, 403. The
 * registry lists each App's roles from lowest to highest.
 */
export function requireAppRole<App extends AppId>(
	identity: Identity<App>,
	app: App,
	role: AppRole<App>,
): void {
	requireAppAccess(identity);
	const roles = APP_REGISTRY[app].roles as readonly string[];
	if (roles.indexOf(identity.appRole) < roles.indexOf(role))
		throw createError({
			statusCode: 403,
			message: `This needs the ${role} App role.`,
			data: { code: 'APP_ROLE_REQUIRED', role },
		});
}
