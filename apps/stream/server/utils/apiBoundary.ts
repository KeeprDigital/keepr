/**
 * Which requests the Session boundary requires a Session for (#396,
 * ADR-0010's protection boundary).
 *
 * Deny-by-default, in the same sense `app/modules/access/pageGate.ts` gives the
 * page gate one layer up: a route added tomorrow is private without anybody
 * remembering to make it private. The posture this replaces was guard-by-guard,
 * and it left all ninety-six `events/**` routes public — the on-air Screen
 * command route and the Melee credential write among them — because a guard has
 * to be *added* to each one and nothing counts the ones nobody added it to.
 *
 * The path policy lives apart from `server/middleware/api-session.ts` for two
 * reasons. It can be exercised as a function, against every route file on disk
 * (`test/unit/server/utils/apiBoundary.test.ts`), rather than only through a
 * mocked event; and the middleware then reads as the two sentences it actually
 * is, with the whole of the decision in one place a reviewer can audit.
 *
 * **The exemptions below are the whole of the exception list.** Adding to it is
 * a decision about what this installation publishes to the internet, so it is
 * one edit in one file, and the test named above pins the resulting set against
 * a literal — a new public route fails that test until somebody writes it down.
 */

/**
 * Every path under here is the boundary's business. Pages, static assets and
 * the SPA shell are outside it altogether: they are unavoidably public under
 * `ssr: false`, and ADR-0010 gates them client-side (`app/middleware/access.global.ts`)
 * as UX rather than as security.
 */
const API_PREFIX = '/api/';

/**
 * Exempt by exact path.
 *
 * Exact rather than prefixed, per entry:
 *
 * - `/api/time` — the Screen Output page's drift correction. A clock reading,
 *   no Event or Screen identity in it, and the one thing an output machine
 *   needs before anything has authorised it.
 * - `/api/release` — which Release this Worker serves (ADR-0119). The deploy's
 *   verify reads it with no session, and it names only the app, its version
 *   and the commit, all public in the repository.
 * - `/api/realtime/token` — an Ably token request. Outside the boundary
 *   because the Screen Output page needs one and has no Session; the route
 *   grants only to a Session or a Screen Output Asset Capability, and refuses
 *   a request carrying neither (ADR-0010's dual grant).
 *
 * An entry is an exact path so that a sibling added beside it is private until
 * somebody decides otherwise: written as a prefix, it would hand every future
 * route under it the same exemption without anyone deciding to.
 */
export const SESSION_EXEMPT_API_PATHS: readonly string[] = [
	'/api/time',
	'/api/release',
	'/api/realtime/token',
];

/**
 * Exempt by prefix, because each of these is one surface with many paths.
 *
 * - `/api/screen-output/` — the Screen Output Asset Capability surface. Every
 *   route under it is authorised by the bearer token the output page already
 *   holds in its URL hash, and refuses **404** rather than 401/403 so a caller
 *   without one cannot use it to enumerate assets. A session requirement here
 *   would put a 401 in front of that posture and hand back the distinction the
 *   404 exists to withhold. The one route with no bearer is
 *   `/api/screen-output/link`, which exchanges the Screen Output Link in its
 *   body for that token and refuses with the same 404.
 * - `/api/public/` — deliberately unauthenticated reads for outside tools
 *   (ADR-0055). Everything under it is public by name, so a route belongs
 *   there only if anyone on the internet may read what it answers.
 *
 * **Nothing of sign-in is here.** A User signs in at Keepr Accounts, on its
 * own host, so Stream Keepr serves no route that must be reachable without a
 * Session for anyone to acquire one (ADR-0141). `/api/identity`, which answers
 * who the browser is, is behind the boundary like any other route.
 *
 * **`/api/admin/` is not exempt** (ADR-0131): a Graphics Administrator is a
 * signed-in User, so the boundary refuses a request with no Session there as
 * anywhere, and a state-changing one another site's page made. Each route under
 * it then calls `requireGraphicsAdministrator` itself for the App role. Checking
 * the role here instead would look stronger and be worse: the guard lives in
 * `server/modules/**`, which a middleware's refusal graph deliberately stops
 * short of (`test/helpers/routeRefusalScan.ts`), so its 403 would become a
 * refusal composed around every route that no exhaustiveness check could see.
 * An admin route added without its own guard is closed by a test that reads
 * every one of those graphs instead.
 */
export const SESSION_EXEMPT_API_PREFIXES: readonly string[] = [
	'/api/screen-output/',
	'/api/public/',
];

/**
 * The path as the exemptions are written, with the one trailing slash Nitro
 * ignores removed.
 *
 * Nitro strips a trailing slash before it matches a route
 * (`withoutTrailingSlash` in its own handler), so `/api/time/` reaches the same
 * handler `/api/time` does. An exemption list that did not know that would read
 * the two spellings differently from the router — which is a difference between
 * what is exempt and what is reachable, and the wrong half of it is somebody
 * getting a private route with no session.
 */
function canonicalPath(pathname: string): string {
	return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

/**
 * Whether this path is the boundary's business at all.
 *
 * Compared case-insensitively, and only in this direction: a request to
 * `/API/events` is treated as an API request and therefore as private. Nothing
 * in this application asks for that spelling, so the cost is nil, and the
 * alternative is trusting that no router, proxy or runtime between here and the
 * handler ever folds case — which is a bet where losing means a private route
 * answered without a session.
 */
function isApiPath(path: string): boolean {
	const folded = path.toLowerCase();
	// The bare form as well as the prefix: no handler answers `/api`, and a path the
	// boundary did not recognise at all is the one shape that would reach a handler
	// unauthenticated if that ever changed.
	return folded === API_PREFIX.slice(0, -1) || folded.startsWith(API_PREFIX);
}

/**
 * Whether this request must present a Session.
 *
 * `false` for everything outside `/api/**`, so the caller does not have to ask
 * two questions; the middleware's whole decision is this function.
 *
 * Give it the **normalised** pathname — `getRequestURL(event).pathname`, which
 * the WHATWG URL parser has already resolved `..` out of. That is the safe
 * direction of the one disagreement with Nitro's router, which matches the raw
 * path: `/api/screen-output/../events/1/players` normalises to a private path
 * here (session required) and matches no route there (404), while
 * `/api/events/../time` normalises to an exempt path here and again matches no
 * route there. Neither spelling reaches a private handler unauthenticated.
 */
export function apiPathRequiresSession(pathname: string): boolean {
	const path = canonicalPath(pathname);

	if (!isApiPath(path)) return false;

	if (SESSION_EXEMPT_API_PATHS.includes(path)) return false;

	return !SESSION_EXEMPT_API_PREFIXES.some((prefix) => path.startsWith(prefix));
}
