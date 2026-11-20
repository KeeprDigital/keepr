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
