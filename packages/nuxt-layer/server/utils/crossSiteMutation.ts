/**
 * The cross-site write check every app's Session-authenticated routes share
 * (ADR-0010, in `apps/stream/docs/adr`; `RULES.md`). An app calls it from its
 * own middleware or route: the layer registers neither.
 */

/**
 * The methods that change nothing. A cross-site page may cause one to be sent,
 * and cannot read what it answers: no route grants another origin a read.
 */
const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

/** What a browser reports in `Sec-Fetch-Site` for a request its own page, or its user, made. */
const OWN_FETCH_SITES: ReadonlySet<string> = new Set(['same-origin', 'none']);

export interface CrossSiteMutationCheck {
	readonly method: string;
	/** The `Sec-Fetch-Site` header, where the browser sent one. */
	readonly secFetchSite: string | null | undefined;
	/** The `Origin` header, where the client sent one. */
	readonly origin: string | null | undefined;
	/** The host this request was addressed to: `getRequestURL(event).host`. */
	readonly requestHost: string;
}

/**
 * Whether a state-changing request was made by a browser on behalf of some
 * other origin, which an app refuses on a Session-authenticated path.
 *
 * A Session cookie is `SameSite=Lax`, which keeps it off a cross-*site* POST and
 * sends it on a cross-origin *same-site* one. Where the cookie is shared across
 * an installation's hosts (ADR-0112, in the root `docs/adr`), and even where it
 * is host-only, a page on a sibling host of the same registrable domain could
 * make a signed-in browser POST here, with no preflight, and h3 reads a body
 * with no content type as JSON. So the cookie alone is not evidence of intent;
 * where the request came from is.
 *
 * In order:
 *
 * 1. A safe method is never refused.
 * 2. `Sec-Fetch-Site`, where present, decides alone: `same-origin` and `none`
 *    are admitted, anything else is refused. A browser sets it and a page
 *    cannot, so it needs no comparison against anything this server believes
 *    about its own address.
 * 3. Otherwise `Origin`, where present, must name the host the request was
 *    addressed to. `null`, and anything that does not parse, is refused.
 * 4. A request with neither header is admitted. Every browser sends `Origin`
 *    on a cross-origin POST, so this is a script, a test or a harness, which
 *    holds a cookie because it signed in and not because a user did.
 *
 * **The scheme is not compared in 3.** A Worker does not reliably know its
 * own: it reads `https` from `x-forwarded-proto` alone, and `wrangler dev`
 * rewrites an `Origin` matching its bind address to `http://` plus the
 * production host, so comparing it would refuse every write from such a
 * browser. What the concession admits is a page served over plain http from
 * this very host, to a browser old enough to send no `Sec-Fetch-Site`.
 */
export function requestIsCrossSiteMutation(request: CrossSiteMutationCheck): boolean {
	if (SAFE_METHODS.has(request.method.toUpperCase())) return false;

	const fetchSite = request.secFetchSite?.trim().toLowerCase();
	if (fetchSite) return !OWN_FETCH_SITES.has(fetchSite);

	const origin = request.origin?.trim();
	if (!origin) return false;

	return originHost(origin) !== request.requestHost.toLowerCase();
}

/** The host an `Origin` header names, or `null` where it names none. */
function originHost(origin: string): string | null {
	if (!URL.canParse(origin)) return null;

	const { protocol, host } = new URL(origin);
	return protocol === 'http:' || protocol === 'https:' ? host : null;
}
