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
import type { SharedIdentityRecords, SharedStore } from './sharedIdentityStore';
import { ServiceConfigurationError, TemporarilyUnavailableError } from './errors';
import { sharedIdentityRecords, workersCacheStore } from './sharedIdentityStore';

/**
 * Who a request belongs to, asked of Keepr Accounts over the Worker-to-Worker
 * connection and checked here against its published keys (ADR-0112, ADR-0113),
 * and shared across the Worker's isolates (ADR-0150).
 * An App calls `resolveRequestIdentity` from its own routes and middleware; the
 * layer registers neither.
 */

/** The connection to Keepr Accounts: in a Worker, the service binding. */
export interface AccountsConnection {
	fetch: (input: string, init?: RequestInit) => Promise<Response>;
}

/**
 * How a signed-in answer's Identity Proof was had: one the resolver held, or
 * found shared by another isolate of its Worker (`cached`), one it held and
 * began refreshing in the background with this answer (`refreshing`), or a
 * fresh one Keepr Accounts was asked for while the request waited (`asked`).
 * Only `asked` costs the request a call to Keepr Accounts, and a resolver's
 * first also fetches its keys unless another isolate shared them. An App's log
 * names it where a request's time matters (#1363).
 */
export type IdentityProofSource = 'cached' | 'refreshing' | 'asked';

/** What Keepr Accounts said about one request, and the cookies to pass to the browser. */
export type IdentityAnswer<App extends AppId> =
	| { kind: 'signed-in'; identity: Identity<App>; setCookie: string[]; proof: IdentityProofSource }
	| { kind: 'signed-out'; setCookie: string[] }
	/** No Identity Proof this App can trust, and no answer that says why: refused. */
	| { kind: 'unavailable'; reason: string; setCookie: string[] };

interface CachedProof<App extends AppId> {
	/** The Identity Proof as Keepr Accounts signed it: what the shared store is given. */
	token: string;
	identity: Identity<App>;
	expiresAt: number;
	refreshAfter: number;
	refreshing: boolean;
	/** Cookies a background refresh was handed, passed on with the next answer. */
	renewedCookies: string[];
}

type Verified<App extends AppId> =
	| { kind: 'signed-in'; identity: Identity<App>; expiresAt: number; refreshAfter: number }
	| { kind: 'refused'; code: unknown; reason: string };

type Defer = (promise: Promise<unknown>) => void;

/**
 * What one request's question carries beside its cookie: how to keep work
 * alive past its response, and its Worker's shared records under the origin
 * the request reached, or none.
 */
interface Question {
	defer: Defer;
	shared: SharedIdentityRecords | undefined;
}

/** What the local dev registry answers for a service with nothing registered under its name. */
const NOTHING_REGISTERED = /Worker ".*" not found/;

/**
 * How long a fresh isolate trusts Keepr Accounts' keys as another isolate
 * fetched them. A key it does not hold is fetched again whatever this is.
 */
const SHARED_KEYS_SECONDS = 60 * 60;

/** How long a request waits on the shared store before it does without it. */
const SHARED_STORE_TIMEOUT_MS = 100;

/**
 * A resolver for one App, holding the Identity Proofs and keys it has verified.
 * A cached Identity Proof answers until it expires, is refreshed in the
 * background once half its life has passed, and keeps answering while Keepr
 * Accounts is unreachable. Past expiry, only a fresh answer does.
 *
 * What it verifies it also shares with its Worker's other isolates through
 * `sharedStore` (ADR-0150), under the origin each request reached the Worker
 * on: the signed token, which each verifies again before answering from it,
 * and Keepr Accounts' keys. A request with no origin shares nothing. Its own
 * `Map` stays in front,
 * and the store is read only when that holds nothing live. A store that fails
 * or is slow is done without: the resolver then works as if it had none.
 */
export function createIdentityResolver<App extends AppId>(
	app: App,
	{
		cacheSize = 1000,
		sharedStore = workersCacheStore(),
		sharedTimeoutMs = SHARED_STORE_TIMEOUT_MS,
	}: { cacheSize?: number; sharedStore?: SharedStore | undefined; sharedTimeoutMs?: number } = {},
) {
	const proofs = new Map<string, CachedProof<App>>();
	let keys: ReturnType<typeof createLocalJWKSet> | undefined;

	function storeFailed(operation: string, error: unknown) {
		console.warn(
			JSON.stringify({
				message: 'identity_store_failed',
				operation,
				reason: (error as Error)?.message ?? String(error),
			}),
		);
	}

	/** One call to the shared store: its answer, or `undefined` once it fails or is not answered in time. */
	async function withShared<T>(
		{ shared }: Question,
		operation: string,
		call: (records: SharedIdentityRecords) => Promise<T>,
	): Promise<T | undefined> {
		if (!shared) return undefined;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const calling = call(shared).catch((error: unknown) => {
			storeFailed(operation, error);
			return undefined;
		});
		const late = new Promise<undefined>((resolve) => {
			timer = setTimeout(() => resolve(undefined), sharedTimeoutMs);
		});
		try {
			return await Promise.race([calling, late]);
		} finally {
			clearTimeout(timer);
		}
	}

	/** A write to the shared store, kept alive past the response, that fails nothing it serves. */
	function toShared(
		question: Question,
		operation: string,
		write: (records: SharedIdentityRecords) => Promise<void>,
	): Promise<void> {
		const writing = withShared(question, operation, write).then(() => undefined);
		question.defer(writing);
		return writing;
	}

	function keySet(published: unknown) {
		try {
			return createLocalJWKSet(published as JSONWebKeySet);
		} catch {
			return undefined;
		}
	}

	async function publicKeys(accounts: AccountsConnection, refetch: boolean, question: Question) {
		if (keys && !refetch) return keys;
		if (!refetch) {
			const sharedKeys = keySet(
				await withShared(question, 'read keys', (records) => records.readKeys()),
			);
			if (sharedKeys) return (keys = sharedKeys);
		}
		const response = await accounts.fetch(`${KEEPR_ACCOUNTS_ORIGIN}${PUBLIC_KEYS_PATH}`);
		if (!response.ok) throw new Error(`its keys answered ${response.status}`);
		const published = (await response.json()) as JSONWebKeySet;
		keys = createLocalJWKSet(published);
		void toShared(question, 'write keys', (records) =>
			records.writeKeys(published, SHARED_KEYS_SECONDS),
		);
		return keys;
	}

	async function verify(
		accounts: AccountsConnection,
		token: string,
		question: Question,
		refetched = false,
	): Promise<Verified<App>> {
		let payload: JWTPayload;
		try {
			({ payload } = await jwtVerify(token, await publicKeys(accounts, refetched, question), {
				issuer: KEEPR_ACCOUNTS_ORIGIN,
				audience: IDENTITY_PROOF_AUDIENCE,
				algorithms: [IDENTITY_PROOF_ALGORITHM],
				requiredClaims: ['sub', 'sid', 'iat', 'exp'],
			}));
		} catch (error) {
			const code = (error as { code?: unknown }).code;
			// An unknown key may be a new one: Keepr Accounts rotated, or the
			// Accounts Stand-in restarted. Its keys are fetched again, once.
			if (code === 'ERR_JWKS_NO_MATCHING_KEY' && !refetched)
				return verify(accounts, token, question, true);
			return {
				kind: 'refused',
				code,
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
		question: Question,
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
			verified = await verify(accounts, token, question);
		} catch (error) {
			return unavailable(`its keys could not be read (${(error as Error).message})`, setCookie);
		}
		if (verified.kind === 'refused') return unavailable(verified.reason, setCookie);
		return {
			answer: { kind: 'signed-in', identity: verified.identity, setCookie, proof: 'asked' },
			cached: {
				token,
				identity: verified.identity,
				expiresAt: verified.expiresAt,
				refreshAfter: verified.refreshAfter,
				refreshing: false,
				renewedCookies: [],
			},
		};
	}

	/**
	 * The Identity Proof another isolate shared for `cookie`, verified here as if
	 * Keepr Accounts had just answered it, or `undefined`. One that does not
	 * verify, an expired one included, answers nobody, and the next ask
	 * replaces it.
	 */
	async function fromOtherIsolates(
		accounts: AccountsConnection,
		cookie: string,
		question: Question,
	): Promise<CachedProof<App> | undefined> {
		const record = await withShared(question, 'read proof', (records) => records.readProof(cookie));
		if (!record) return undefined;
		let verified: Verified<App>;
		try {
			verified = await verify(accounts, record.token, question);
		} catch {
			return undefined;
		}
		if (verified.kind === 'refused') {
			if (verified.code !== 'ERR_JWT_EXPIRED')
				console.warn(
					JSON.stringify({ message: 'identity_store_refused', reason: verified.reason }),
				);
			return undefined;
		}
		return {
			token: record.token,
			identity: verified.identity,
			expiresAt: verified.expiresAt,
			refreshAfter: verified.refreshAfter,
			refreshing: false,
			renewedCookies: record.renewedCookies,
		};
	}

	/** Shares `proof` for as long as it lasts, with the renewed cookies no browser has been sent. */
	function share(
		cookie: string,
		proof: CachedProof<App>,
		renewedCookies: string[],
		question: Question,
	) {
		const ttlSeconds = Math.floor((proof.expiresAt - Date.now()) / 1000);
		if (ttlSeconds <= 0) return Promise.resolve();
		return toShared(question, 'write proof', (records) =>
			records.writeProof(cookie, { token: proof.token, renewedCookies }, ttlSeconds),
		);
	}

	function remember(cookie: string, proof: CachedProof<App>) {
		proofs.delete(cookie);
		proofs.set(cookie, proof);
		for (const oldest of proofs.keys()) {
			if (proofs.size <= cacheSize) break;
			proofs.delete(oldest);
		}
	}

	async function refresh(
		accounts: AccountsConnection,
		cookie: string,
		proof: CachedProof<App>,
		question: Question,
		{ sharedFirst }: { sharedFirst: boolean },
	) {
		// Another isolate may already have refreshed it: then that answers here too.
		if (sharedFirst) {
			const refreshed = await fromOtherIsolates(accounts, cookie, question);
			if (refreshed && Date.now() < refreshed.refreshAfter) {
				remember(cookie, refreshed);
				return;
			}
		}
		const { answer, cached } = await ask(accounts, cookie, question);
		if (cached) {
			remember(cookie, { ...cached, renewedCookies: answer.setCookie });
			await share(cookie, cached, answer.setCookie, question);
		} else if (answer.kind === 'signed-out') {
			proofs.delete(cookie);
			await toShared(question, 'remove proof', (records) => records.removeProof(cookie));
		}
		// Unreachable: the cached proof keeps answering until it expires.
		else proof.refreshing = false;
	}

	/**
	 * The cookies a refresh renewed, once. They are shared with the proof, so
	 * whichever isolate answers the browser next passes them on; the shared
	 * record then drops them, and another isolate holding them sends none. With
	 * no shared record to ask, they are sent: twice is harmless, never is not.
	 */
	async function renewedCookiesOf(cookie: string, proof: CachedProof<App>, question: Question) {
		const renewed = proof.renewedCookies;
		if (renewed.length === 0) return [];
		proof.renewedCookies = [];
		const record = await withShared(question, 'read proof', (records) => records.readProof(cookie));
		if (record?.token !== proof.token) return renewed;
		if (record.renewedCookies.length === 0) return [];
		void share(cookie, proof, [], question);
		return renewed;
	}

	async function answerFrom(
		accounts: AccountsConnection,
		cookie: string,
		proof: CachedProof<App>,
		question: Question,
		{ sharedFirst }: { sharedFirst: boolean },
	): Promise<IdentityAnswer<App>> {
		const refreshes = Date.now() >= proof.refreshAfter && !proof.refreshing;
		if (refreshes) {
			proof.refreshing = true;
			question.defer(refresh(accounts, cookie, proof, question, { sharedFirst }));
		}
		return {
			kind: 'signed-in',
			identity: proof.identity,
			setCookie: await renewedCookiesOf(cookie, proof, question),
			proof: refreshes ? 'refreshing' : 'cached',
		};
	}

	/**
	 * Who the request carrying `cookie` belongs to. `waitUntil` keeps a background
	 * refresh, and a write to the shared store, alive past the response, as a
	 * Worker's `ctx.waitUntil` does. `origin` is the origin the Worker was
	 * reached on, which the shared records are kept under; with none, the
	 * resolver shares nothing.
	 */
	return async function resolve({
		cookie = '',
		accounts,
		waitUntil,
		origin,
	}: {
		cookie?: string | undefined;
		accounts: AccountsConnection;
		waitUntil?: ((promise: Promise<unknown>) => void) | undefined;
		origin?: string | undefined;
	}): Promise<IdentityAnswer<App>> {
		const question: Question = {
			defer: (promise) => waitUntil?.(promise),
			shared: sharedStore && origin ? sharedIdentityRecords(sharedStore, app, origin) : undefined,
		};
		const held = proofs.get(cookie);
		if (held && Date.now() < held.expiresAt)
			return await answerFrom(accounts, cookie, held, question, { sharedFirst: true });
		proofs.delete(cookie);

		const sharedProof = await fromOtherIsolates(accounts, cookie, question);
		if (sharedProof) {
			remember(cookie, sharedProof);
			return await answerFrom(accounts, cookie, sharedProof, question, { sharedFirst: false });
		}

		const { answer, cached } = await ask(accounts, cookie, question);
		if (cached) {
			remember(cookie, cached);
			// This answer passes its cookies on itself, so the shared record holds none.
			void share(cookie, cached, [], question);
		}
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
export function accountsConnectionOf(event: H3Event): AccountsConnection {
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
 * The origin the Worker was reached on: the URL of the request Cloudflare
 * routed to it, as Nitro hands it on, and never a header a client could set,
 * such as `X-Forwarded-Host`. `undefined` outside a Worker, as under Node.
 */
function workerOriginOf(event: H3Event): string | undefined {
	const request = (event.context as { cloudflare?: { request?: { url?: unknown } } }).cloudflare
		?.request;
	if (typeof request?.url !== 'string') return undefined;
	try {
		return new URL(request.url).origin;
	} catch {
		return undefined;
	}
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
		origin: workerOriginOf(event),
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
 * Refuses an Identity without `role` or a role above it in its App, 403. The
 * registry lists each App's roles from lowest to highest.
 */
export function requireAppRole<App extends AppId>(
	identity: Identity<App>,
	role: NoInfer<AppRole<App>>,
): void {
	requireAppAccess(identity);
	const roles = APP_REGISTRY[identity.app].roles as readonly string[];
	if (roles.indexOf(identity.appRole) < roles.indexOf(role))
		throw createError({
			statusCode: 403,
			message: `This needs the ${role} App role.`,
			data: { code: 'APP_ROLE_REQUIRED', role },
		});
}
