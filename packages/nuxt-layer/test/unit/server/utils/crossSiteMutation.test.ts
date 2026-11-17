import { describe, expect, it } from 'vitest';
import { requestIsCrossSiteMutation } from '../../../../server/utils/crossSiteMutation';

// A Session cookie is `SameSite=Lax` and host-only, so a page on a sibling
// subdomain can make a signed-in browser send it. A state-changing request is
// admitted only when the browser says it came from this origin, or says nothing.
describe('which state-changing requests are refused as cross-site', () => {
	const HOST = 'stream.keepr.digital';

	it.each([
		// What the browser reports about itself decides, where it reports it.
		['POST', 'same-origin', `https://${HOST}`, HOST, false],
		['POST', 'Same-Origin', undefined, HOST, false],
		['POST', 'none', undefined, HOST, false],
		['POST', 'same-site', `https://evil.keepr.digital`, HOST, true],
		['POST', 'cross-site', 'https://not-this-installation.example', HOST, true],
		['POST', 'cross-site', `https://${HOST}`, HOST, true],
		['POST', 'something-new', undefined, HOST, true],
		// `wrangler dev` rewrites `Origin` to the route's host; the browser's own
		// verdict still stands.
		['POST', 'same-origin', `http://${HOST}`, '127.0.0.1:8787', false],
		// A browser that sends no `Sec-Fetch-Site`: `Origin` must name this host.
		['POST', undefined, `https://${HOST}`, HOST, false],
		['POST', '', `https://${HOST}`, HOST, false],
		['POST', undefined, 'http://localhost:3000', 'localhost:3000', false],
		['POST', undefined, 'http://192.168.1.20:3000', '192.168.1.20:3000', false],
		['POST', undefined, `https://evil.keepr.digital`, HOST, true],
		['POST', undefined, `https://${HOST}.evil.example`, HOST, true],
		['POST', undefined, `https://${HOST}:8443`, HOST, true],
		['POST', undefined, 'http://localhost:3001', 'localhost:3000', true],
		['POST', undefined, 'null', HOST, true],
		['POST', undefined, 'not an origin', HOST, true],
		// The scheme is not compared: the Worker does not reliably know its own.
		['POST', undefined, `http://${HOST}`, HOST, false],
		// Neither header: not a browser, so not a browser being used against its user.
		['POST', undefined, undefined, HOST, false],
		['PUT', undefined, `https://evil.keepr.digital`, HOST, true],
		['PATCH', 'same-site', undefined, HOST, true],
		['DELETE', 'cross-site', undefined, HOST, true],
		['delete', 'cross-site', undefined, HOST, true],
		// Reads change nothing, and a cross-site page cannot read their answers.
		['GET', 'cross-site', 'https://not-this-installation.example', HOST, false],
		['HEAD', 'cross-site', 'https://not-this-installation.example', HOST, false],
		['OPTIONS', 'cross-site', 'https://not-this-installation.example', HOST, false],
	] as const)(
		'%s with Sec-Fetch-Site %j and Origin %j at %s: refused %s',
		(method, secFetchSite, origin, requestHost, refused) => {
			expect(
				requestIsCrossSiteMutation({
					method,
					secFetchSite,
					origin,
					requestHost,
				}),
			).toBe(refused);
		},
	);
});
