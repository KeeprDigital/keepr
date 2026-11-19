import { requestIsCrossSiteMutation } from '@keepr/nuxt-layer/server/utils/crossSiteMutation';
import { apiPathRequiresSession } from '~~/server/utils/apiBoundary';
import { requestIdentity } from '~~/server/utils/session';

/**
 * The deny-by-default Session boundary (ADR-0010, ADR-0141): every `/api/**`
 * route requires a Session, and App access to Stream Keepr, unless
 * `apiPathRequiresSession` exempts it. Who the request belongs to is read from
 * an Identity Proof Keepr Accounts signs (`server/utils/session.ts`), and from
 * nothing else: nothing here, or anywhere in a build, can skip the question.
 *
 * This is the wall. The page gate in `app/middleware/access.global.ts` is UX: it
 * spares a signed-out browser a shell of pages whose every request comes back
 * 401, and a client-side gate protects nothing on its own. What protects this
 * Installation is that a request with no Session never reaches a handler behind
 * the boundary.
 *
 * **Named to sort first.** Nitro composes `server/middleware/**` in filename
 * order, and this file's name puts it ahead of all three of its neighbours,
 * which is load-bearing rather than incidental:
 *
 * - `event-exists.ts` answers 404 for an Event that is not there. Running it
 *   first would let a signed-out caller ask which Event ids exist and read the
 *   answer off the difference between 404 and 401.
 * - `request-body-limit.ts` wraps the request body in a bounded stream, and
 *   `retired-author-session-cookies.ts` expires stale cookies. Neither is work
 *   worth doing for a request that is about to be refused.
 *
 * **A state-changing request another site's page made is refused 403** before
 * the Session is read: the Session cookie is shared by every host under the
 * Keepr domain and is `SameSite=Lax`, which leaves a sibling subdomain able to
 * make a signed-in browser POST here.
 *
 * **The 401 and the cross-site 403 are written out here, as literals, on
 * purpose.** Each is composed around every route in the application, so it
 * lands in every graph `test/helpers/routeRefusalScan.ts` builds, and that scan
 * resolves a `const` only within the file it is reading. A status or a message
 * imported from elsewhere would arrive at the exhaustiveness check as a refusal
 * it could not read, which is the shape #277 was filed over. So the layer's own
 * 401 for a signed-out visitor is answered here in the boundary's words: one
 * uniform 401, in the one place a reader of the middleware directory will find
 * it.
 *
 * **Two refusals are the layer's, in the layer's words, and the same in every
 * App** (`packages/nuxt-layer/server/utils/requestIdentity.ts`): the 403 for a
 * User with no App access to Stream Keepr, and the 503 while there is no
 * Identity Proof to trust and Keepr Accounts does not answer.
 *
 * `test/integration/apiBoundary.test.ts` is where real requests meet it;
 * `test/unit/server/middleware/apiSession.test.ts` pins the shape.
 */
export default defineEventHandler(async (event) => {
	const url = getRequestURL(event);
	if (!apiPathRequiresSession(url.pathname)) return;

	// Before the Session is read: a Session cookie on a state-changing request
	// another site's page made is the thing being refused, so whether it is a
	// valid one is not worth asking Keepr Accounts. The rule, and why a request
	// naming no origin at all is admitted, is `requestIsCrossSiteMutation`.
	// The exempt surfaces need none of it: each carries a credential a
	// cross-site page cannot attach (a bearer, or a Screen Output Link in the
	// body, which a page can send only if it already holds it), or changes
	// nothing.
	const crossSite = requestIsCrossSiteMutation({
		method: event.method,
		secFetchSite: event.headers.get('sec-fetch-site'),
		origin: event.headers.get('origin'),
		requestHost: url.host,
	});
	if (crossSite) {
		throw createError({
			statusCode: 403,
			statusMessage: 'Forbidden',
			message: 'Cross-site request refused',
		});
	}

	// Asked through `requestIdentity`, so this answer is the one the handler
	// behind it reuses: a route asks the same request who the User is and which
	// Session they are in, and the question is put to Keepr Accounts once. It
	// refuses a User with no App access itself, 403, and raises the 503 that
	// names why when Keepr Accounts cannot be asked.
	const identity = await requestIdentity(event);

	if (!identity) {
		// One message for every request with no Session. A per-reason sentence
		// would say which of "no cookie", "expired", "ended" or "disabled User"
		// happened, none of which the caller can act on differently: all are
		// answered by signing in again.
		throw createError({
			statusCode: 401,
			statusMessage: 'Unauthorized',
			message: 'Authentication is required',
		});
	}
});
