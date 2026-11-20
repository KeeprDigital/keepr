import { defineEventHandler, deleteCookie, getRequestHeader } from 'h3';
import { RETIRED_SIGN_IN_COOKIE, withoutShadowedCookie } from '~~/server/utils/retiredSignInCookie';

/**
 * Takes the cookie of Stream Keepr's former sign-in out of a request that also
 * carries Keepr Accounts' session cookie, and expires it in the browser
 * (ADR-0141).
 *
 * Correctness, not hygiene. The two have one name. Keepr Accounts reads the
 * first it is sent, which is the retired one: it knows no such Session, so it
 * answers that nobody is signed in and clears its own cookie. A User who was
 * signed in to Stream Keepr before the cutover then signs in at Keepr Accounts,
 * is sent back, and is sent to sign in again, without end.
 *
 * **It runs before the Session boundary**, which is why its file sorts first:
 * the boundary asks Keepr Accounts with the request's `Cookie` header, and has
 * to ask with this one already out of it.
 *
 * Only a request that carries the name twice is touched. One that carries it
 * once is either Keepr Accounts' own, or the retired one alone: that browser is
 * told to sign in, comes back with both, and is put right then.
 *
 * It refuses nothing: it is composed around every route.
 *
 * Safe to delete once no browser that was signed in before the cutover is
 * still in use: Stream Keepr's Sessions lasted seven days.
 */
export default defineEventHandler((event) => {
	const cookies = withoutShadowedCookie(getRequestHeader(event, 'cookie'), RETIRED_SIGN_IN_COOKIE);
	if (cookies === null) return;
	event.node.req.headers.cookie = cookies;
	// No `domain`: the retired cookie is this host's own, and Keepr Accounts' is
	// the Keepr domain's, which this leaves alone.
	deleteCookie(event, RETIRED_SIGN_IN_COOKIE, {
		path: '/',
		secure: true,
		httpOnly: true,
		sameSite: 'lax',
	});
});
