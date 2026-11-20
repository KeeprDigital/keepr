import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { createEvent, getRequestHeader } from 'h3';
import { describe, expect, it } from 'vitest';
import { discardRetiredSignInCookie } from '~~/server/utils/retiredSignInCookie';

const NAME = '__Secure-better-auth.session_token';

/** A request as h3 hands one to a route, carrying `cookie`. */
function requestCarrying(cookie?: string) {
	const request = new IncomingMessage(new Socket());
	if (cookie !== undefined) request.headers.cookie = cookie;
	const response = new ServerResponse(request);
	return { event: createEvent(request, response), response };
}

// ADR-0141: a browser signed in before the cutover sends Stream Keepr's retired
// cookie and Keepr Accounts' under one name, the retired one first.
describe("the cookie of Stream Keepr's former sign-in", () => {
	it("is taken out of the request, so what asks Keepr Accounts next carries Keepr Accounts' alone", () => {
		const { event } = requestCarrying(`${NAME}=retired; other=1; ${NAME}=accounts`);

		discardRetiredSignInCookie(event);

		expect(getRequestHeader(event, 'cookie')).toBe(`other=1; ${NAME}=accounts`);
	});

	it("is expired on this host, and never on the Keepr domain, where Keepr Accounts' own is", () => {
		const { event, response } = requestCarrying(`${NAME}=retired; ${NAME}=accounts`);

		discardRetiredSignInCookie(event);

		const [expiry, ...more] = [response.getHeader('set-cookie')].flat();
		expect(more).toEqual([]);
		expect(String(expiry)).toMatch(new RegExp(`^${NAME}=;`));
		expect(String(expiry)).toMatch(/Max-Age=0/i);
		expect(String(expiry)).toMatch(/Path=\//i);
		// A `__Secure-` cookie is only written, and so only expired, as `Secure`.
		expect(String(expiry)).toMatch(/;\s*Secure/i);
		expect(String(expiry)).not.toMatch(/Domain=/i);
	});

	it.each([
		["Keepr Accounts' cookie alone", `${NAME}=accounts; other=1`],
		['no cookie of the name', 'other=1'],
		['no cookie at all', undefined],
	])('leaves a request with %s as it came, and writes nothing', (_case, cookie) => {
		const { event, response } = requestCarrying(cookie);

		discardRetiredSignInCookie(event);

		expect(getRequestHeader(event, 'cookie')).toBe(cookie);
		expect(response.getHeader('set-cookie')).toBeUndefined();
	});
});
