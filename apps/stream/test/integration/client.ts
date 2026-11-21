import { $fetch as unsigned$Fetch, fetch as unsignedFetch } from '@nuxt/test-utils/e2e';
import { INTEGRATION_OPERATOR_COOKIE, INTEGRATION_SIGNED_OUT_COOKIE } from './environment';
import { requestLabel, requestLedger } from './requestLedger';

/**
 * The integration suite's HTTP client: `@nuxt/test-utils`' own, asking as the
 * suite's operator (#396, ADR-0141).
 *
 * ADR-0010's deny-by-default boundary means every route here answers a Session,
 * so **every suite imports `fetch` and `$fetch` from here rather than from
 * `@nuxt/test-utils/e2e`**. Each server the suite starts runs beside an
 * Accounts Stand-in (`./servers.ts`), which vouches for whoever the request's
 * `keepr-stand-in` cookie names, as Keepr Accounts vouches for a Session cookie.
 * Nobody signs in: there is nothing in Stream Keepr to sign in to.
 *
 * It is an explicit import rather than a global patch on purpose:
 *
 * - A patched `globalThis.fetch` does not work here at all, which is worth writing
 *   down because it looks like it should. `@nuxt/test-utils` calls `ofetch`'s
 *   `fetch`, which dereferences its own realm's global, and an externalised
 *   dependency's realm is not the test file's, so the patch is installed, visible
 *   from the test, and never consulted.
 * - Even where it worked it would be invisible. A suite whose requests are
 *   vouched for by machinery in a config file reads as a suite testing
 *   unauthenticated routes.
 *
 * **Who asks is appended, never substituted, and never appended to a request
 * that says who it is already** (see `signed` below, and `./identities.ts` for
 * who a suite can ask as instead of the operator).
 */

/**
 * Whether this path is one the client signs: every API path.
 *
 * Deliberately **not** derived from `apiPathRequiresSession`. A client built from
 * the boundary's own allowlist could not catch a mistake in it: both would exempt
 * the same path and the suite would pass. An exempt route is signed too, and
 * ignores it.
 *
 * Pages are left alone because nothing about them needs a Session: the boundary
 * covers `/api/**`, and a page request's answer must be the one a real browser
 * gets.
 */
export function requestCarriesSession(path: string): boolean {
	return path.startsWith('/api/');
}

/**
 * The cookie the suite's operator asks with, for a request the client does not
 * make: a socket, or a hand-built header. Asynchronous for the suites that
 * await it, from when the operator had to sign in.
 */
export async function operatorSessionCookie(): Promise<string> {
	return INTEGRATION_OPERATOR_COOKIE;
}

/**
 * The one retry in this suite, re-exported so a caller needs one import.
 *
 * It lives in `./transportRetry` rather than here because it is the only thing in
 * this file that can be tested without a spawned server.
 * `test/unit/integration/transportRetry.test.ts` pins it.
 *
 * Deliberately **not** applied inside `fetch` and `$fetch` below: they cannot
 * rebuild a streamed body, which is the shape that actually fails, so a retry there
 * would be the layer that cannot do the job doing it twice.
 */
export { throughOneTransportFailure } from './transportRetry';

/** The cookie that says who a request asks as, wherever it sits in the header. */
const WHO_ASKS = /(?:^|;\s*)keepr-stand-in=/;

/**
 * One request's headers, with `cookie` saying who asks unless the caller said so.
 *
 * **A caller's own identity wins.** Appending would put the same cookie name in
 * one header twice and leave who the server reads to whichever end of the header
 * it parsed first. So a request that already says who it is is left exactly as
 * the caller wrote it, which is also what makes `./identities.ts` work at all.
 */
function asking(
	path: string,
	headers: HeadersInit | undefined,
	cookie: string,
): Record<string, string> {
	const merged = new Headers(headers ?? {});
	const own = merged.get('cookie');
	if (requestCarriesSession(path) && !WHO_ASKS.test(own ?? ''))
		merged.set('cookie', [own, cookie].filter(Boolean).join('; '));

	return Object.fromEntries(merged);
}

/**
 * `@nuxt/test-utils`' `fetch`, asking as the operator.
 *
 * Same signature, so a suite reads exactly as it did before the boundary existed,
 * which is the point: what changed is who the suite is, not what it asserts.
 */
export const fetch: typeof unsignedFetch = async (path, options) => {
	const headers = asking(path, options?.headers, INTEGRATION_OPERATOR_COOKIE);
	return await requestLedger.record(
		requestLabel(path, options?.method),
		async () => await unsignedFetch(path, { ...options, headers }),
	);
};

/**
 * The same function with its route inference switched off, for use inside the
 * wrappers only.
 *
 * Nitro types `$fetch` against every route in the application, and instantiating
 * that machinery inside a wrapper exhausts TypeScript's depth budget: `vue-tsc`
 * answers TS2321 "Excessive stack depth". Nothing is lost by narrowing, because
 * the exported binding is declared as `typeof unsigned$Fetch`: every **caller**
 * keeps the real types, including the `$fetch<Screen>(…)` generics the suites
 * rely on. The same goes for `requestLedger.record` inside them: left to infer,
 * its `T` is drawn from the cast's contextual return type, so it is pinned to
 * `unknown`.
 */
const untyped$Fetch = unsigned$Fetch as unknown as (
	path: string,
	options?: Record<string, unknown>,
) => Promise<unknown>;

/** `@nuxt/test-utils`' `$fetch`, asking as the operator. */
export const $fetch: typeof unsigned$Fetch = (async (
	path: string,
	options?: Record<string, unknown>,
) => {
	const headers = asking(
		path,
		options?.headers as HeadersInit | undefined,
		INTEGRATION_OPERATOR_COOKIE,
	);
	return await requestLedger.record<unknown>(
		requestLabel(path, options?.method),
		async () => await untyped$Fetch(path, { ...options, headers }),
	);
}) as typeof unsigned$Fetch;

/**
 * The same two helpers asking as a signed-out visitor, for the suite that tests
 * the boundary itself.
 *
 * They say so with the stand-in's cookie, so Keepr Accounts' stand-in is asked
 * and says no: a boundary test is then a test of the answer, not of a request
 * nobody asked about. Recorded like the signed pair, so a stall here is named
 * too.
 */
export const anonymousFetch: typeof unsignedFetch = async (path, options) => {
	const headers = asking(path, options?.headers, INTEGRATION_SIGNED_OUT_COOKIE);
	return await requestLedger.record(
		requestLabel(path, options?.method),
		async () => await unsignedFetch(path, { ...options, headers }),
	);
};
export const anonymous$Fetch: typeof unsigned$Fetch = (async (
	path: string,
	options?: Record<string, unknown>,
) => {
	const headers = asking(
		path,
		options?.headers as HeadersInit | undefined,
		INTEGRATION_SIGNED_OUT_COOKIE,
	);
	return await requestLedger.record<unknown>(
		requestLabel(path, options?.method),
		async () => await untyped$Fetch(path, { ...options, headers }),
	);
}) as typeof unsigned$Fetch;

/**
 * The rest of `@nuxt/test-utils/e2e`'s surface, passed straight through.
 *
 * Nothing about these needs a Session: they start the server, publish its URL, and
 * resolve a path against it. They are re-exported so the structural guard can be
 * absolute: **one** file in `test/integration/` names the raw module, and it is this
 * one, so "who is this suite asking as?" has a single answer everywhere else.
 */
export { createTest, exposeContextToEnv, url } from '@nuxt/test-utils/e2e';
