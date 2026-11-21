import type { H3Event } from 'h3';
import { getRequestURL, setResponseHeaders } from 'h3';

/**
 * What every response of Keepr Accounts carries (#1385): no page of it is framed
 * by another, a browser keeps to https and to the type each response declares,
 * and a link followed from it tells another origin no more than its own.
 *
 * The Content Security Policy restricts only what needs no knowledge of the
 * pages' scripts: framing, `<base>`, forms, plugins. Nuxt's pages carry inline
 * scripts, which a `script-src` would have to name by hash.
 */
export const SECURITY_HEADERS = {
	'content-security-policy':
		"frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
	'x-frame-options': 'DENY',
	'strict-transport-security': 'max-age=31536000; includeSubDomains',
	'x-content-type-options': 'nosniff',
	'referrer-policy': 'strict-origin-when-cross-origin',
} as const;

/** Where Keepr Accounts' answers are: every one of them a User's, so none is stored. */
const API_PATH = /^\/api(?:\/|$)/;

/** Sets the security headers on `event`'s response, and `no-store` on an API answer. */
export function applySecurityHeaders(event: H3Event): void {
	setResponseHeaders(event, SECURITY_HEADERS);
	if (API_PATH.test(getRequestURL(event).pathname))
		setResponseHeaders(event, { 'cache-control': 'no-store' });
}
