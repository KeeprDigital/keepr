import type { H3Event } from 'h3';
import { deleteCookie, getRequestHeader } from 'h3';

/**
 * The cookie Stream Keepr's own sign-in set, until ADR-0141 removed that
 * sign-in: on Stream Keepr's host alone. Keepr Accounts' session cookie has the
 * same name, on the Keepr domain, so a browser that was signed in before the
 * cutover sends both, the retired one first.
 *
 * A literal, and the only place the name is written here: Stream Keepr sets no
 * cookie of this name any more, and reads the one Keepr Accounts set only by
 * passing the request's cookies on.
 */
export const RETIRED_SIGN_IN_COOKIE = '__Secure-better-auth.session_token';

/**
 * A `Cookie` header that carries `name` more than once, with every one of them
 * but the last taken out; `null` for a header that carries it once or never,
 * which is left as it came.
 *
 * The last is kept because a browser lists cookies of one path oldest first,
 * and the retired one is the older wherever its browser has signed in at Keepr
 * Accounts since. Where it is not, the request is read as signed out, once.
 */
export function withoutShadowedCookie(header: string | undefined, name: string): string | null {
	if (!header) return null;
	const cookies = header.split(';').map((cookie) => cookie.trim());
	const named = (cookie: string) => cookie.split('=', 1)[0] === name;
	const last = cookies.findLastIndex(named);
	const kept = cookies.filter((cookie, index) => !named(cookie) || index === last);
	return kept.length === cookies.length ? null : kept.join('; ');
}

/**
 * Take the cookie of Stream Keepr's former sign-in out of a request that also
 * carries Keepr Accounts' session cookie, and expire it in the browser
 * (ADR-0141). Called where a request's identity is read, before Keepr Accounts
 * is asked.
 *
 * Correctness, not hygiene. Keepr Accounts reads the first cookie of the name
 * it is sent, which is the retired one: it knows no such Session, so it
 * answers that nobody is signed in. A User who was signed in to Stream Keepr
 * before the cutover then signs in at Keepr Accounts, is sent back, and is sent
 * to sign in again, without end.
 *
 * Only a request that carries the name twice is touched. One that carries it
 * once is either Keepr Accounts' own, or the retired one alone: that browser is
 * told to sign in, comes back with both, and is put right then.
 *
 * Not a middleware: the Session boundary sorts ahead of every other, so that
 * nothing answers a signed-out caller before it does, and this has to come
 * before the boundary asks.
 *
 * Safe to delete once no browser that was signed in before the cutover is
 * still in use: Stream Keepr's Sessions lasted seven days.
 */
export function discardRetiredSignInCookie(event: H3Event): void {
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
}
