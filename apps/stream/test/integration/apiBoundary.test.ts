import { LOCAL_DEVELOPER_COOKIE } from '@keepr/accounts-stand-in/cookie';
import { describe, expect, it } from 'vitest';
import { $fetch, anonymousFetch, fetch, url } from './client';
import { INTEGRATION_OPERATOR_ID } from './environment';
import { aUserWithoutAccess, aUserWithoutTheRole } from './identities';

/**
 * The deny-by-default Session boundary as a request meets it (#396, ADR-0010,
 * ADR-0141), on a server whose `KEEPR_ACCOUNTS` binding the Accounts Stand-in
 * answers: who asks is the stand-in's to say, and every admission and refusal
 * here is the server's own.
 *
 * What this file owns over the unit suite is that the middleware is **mounted and
 * composed around real routes** — that Nitro runs it before the handler, before
 * `event-exists.ts`, and on paths nobody wrote it a rule for. The path policy
 * itself is exercised against every route file on disk in
 * `test/unit/server/utils/apiBoundary.test.ts`, which is the only place the claim
 * "exhaustive" can be checked.
 *
 * Most requests here go through `anonymousFetch`, deliberately. The rest of the
 * suite asks as its operator (see `client.ts`), and a boundary proved only by the
 * absence of failures elsewhere is a boundary nobody tested: the same green run
 * would come back from a middleware that admitted everybody.
 */

const REFUSAL = 'Authentication is required';

async function anonymous(path: string, init: RequestInit = {}) {
	const response = await anonymousFetch(path, init);
	const text = await response.text();
	return {
		status: response.status,
		message: (() => {
			try {
				return (JSON.parse(text) as { message?: string }).message;
			} catch {
				return undefined;
			}
		})(),
	};
}

describe('the API boundary', () => {
	/**
	 * One read and one write, rather than one per route: what is being
	 * established is that the middleware runs at all and refuses by default.
	 * Which paths are private is exhaustive against the routes on disk in the
	 * unit suite, where it can be, and a census by HTTP would be a hundred and
	 * sixty requests establishing the same thing. The two orderings only a real
	 * server has, ahead of `event-exists.ts` and ahead of the router, are the
	 * cases below.
	 */
	it.each([
		// A collection read, and the plainest possible case.
		['GET', '/api/graphics-assets'],
		// A write. The boundary must refuse before the body is read, not after.
		['POST', '/api/events'],
	])('refuses a %s %s with no Identity Proof, as one uniform 401', async (method, path) => {
		const { status, message } = await anonymous(path, { method });

		expect(status).toBe(401);
		expect(message).toBe(REFUSAL);
	});

	it('refuses before the Event-existence middleware can say whether the Event is there', async () => {
		// Read as a pair, because the leak is a difference rather than a status: an
		// Event that exists and one that does not have to be indistinguishable to a
		// caller with no session.
		// Its own Event, because no fixed id names one that exists (#630).
		const event = await $fetch('/api/events', {
			method: 'POST',
			body: {
				name: 'API Boundary Existence Event',
				game: 'mtg',
				featureMatchOrientation: 'horizontal',
			},
		});
		try {
			const missing = await anonymous('/api/events/999999999/players');
			const present = await anonymous(`/api/events/${event.id}/players`);

			expect(missing).toEqual(present);
			expect(missing.status).toBe(401);
		} finally {
			await $fetch(`/api/events/${event.id}`, { method: 'DELETE' });
		}
	});

	/**
	 * There is no row here for an **oversized** mutation being answered 401 rather
	 * than 413, and the absence is deliberate rather than an oversight.
	 *
	 * The claim is true and was observed: a body over `MAX_API_REQUEST_BODY_BYTES`
	 * comes back 401. But refusing before the body is read is exactly what leaves
	 * the request's bytes unconsumed, so the server closes the connection on them
	 * and the **next** request to reuse that pooled socket fails with ECONNRESET —
	 * in the next file as readily as the next test, since the suite runs one worker
	 * with `fileParallelism: false`. A row that poisons whatever runs after it is
	 * worth less than the flake it costs.
	 *
	 * What is pinned instead is the property the ordering rests on: `api-session.ts`
	 * sorts first in `server/middleware/`, which is the order Nitro composes them
	 * in (`test/unit/server/middleware/apiSession.test.ts`). The half that only a
	 * real request can establish — that `event-exists.ts` really does run after
	 * this — is the pair of rows above.
	 */
	it('admits the same request on a valid Identity Proof, and knows whose it is', async () => {
		// The negative control for every row above: they would all pass against a
		// middleware that refused everything, which is a broken installation rather
		// than a boundary. `/api/events` because it is behind the boundary and
		// nothing else.
		expect((await fetch('/api/events')).status).toBe(200);

		const identity = (await (await fetch('/api/identity')).json()) as {
			user: { id: string };
			appRole: string;
		};
		expect(identity).toMatchObject({ user: { id: INTEGRATION_OPERATOR_ID }, appRole: 'admin' });
	});

	// What `pnpm dev` gives a browser: this server was started as `pnpm dev`
	// starts one, through the Accounts Stand-in. With no cookie it is signed out,
	// and its page gate sends it to the stand-in's sign-in, which gives it the
	// cookie that names the Local Developer User (ADR-0158). `globalThis.fetch`,
	// because the suite's client always says who asks.
	it.each([
		['refuses a request that carries no cookie at all, 401', {}, 401, { message: REFUSAL }],
		[
			"recognises the Local Developer User on the cookie the stand-in's sign-in gives",
			{ cookie: LOCAL_DEVELOPER_COOKIE },
			200,
			{ user: { id: 'local-developer', name: 'Local Developer' }, appRole: 'admin' },
		],
	])('%s', async (_case, headers, status, body) => {
		const response = await globalThis.fetch(url('/api/identity'), { headers });

		expect(response.status).toBe(status);
		expect(await response.json()).toMatchObject(body);
	});

	// The same way everywhere: a read, a write, an admin route and "who am I".
	it.each([
		['GET', '/api/events'],
		['POST', '/api/events'],
		['GET', '/api/admin/graphics-assets/health'],
		['GET', '/api/identity'],
	])('refuses a User with no App access to Stream Keepr: %s %s', async (method, path) => {
		const response = await fetch(path, {
			method,
			headers: { cookie: await aUserWithoutAccess('api-boundary-no-access') },
		});
		const body = (await response.json()) as { data?: { code?: string } };

		expect(response.status).toBe(403);
		expect(body.data?.code).toBe('NO_APP_ACCESS');
	});

	it('admits a User whose App role is member, who is no Graphics Administrator', async () => {
		const response = await fetch('/api/events', {
			headers: { cookie: await aUserWithoutTheRole('api-boundary-no-role') },
		});

		expect(response.status).toBe(200);
	});

	/**
	 * A Session cookie is `SameSite=Lax` and every Keepr host's, which a sibling
	 * subdomain's page can still make a browser send on a POST. The rule is exercised row by row in
	 * the unit suite; here a real server answers each side of it once, with a
	 * real `Host` to compare an `Origin` against.
	 */
	it.each([
		// Read when the case runs: the server's address exists only then.
		['its own origin is named', 400, () => ({ origin: new URL(url('/')).origin })],
		['another origin is named', 403, () => ({ origin: 'https://not-this-installation.example' })],
	])('answers a signed-in POST when %s: %i', async (_case, status, headers) => {
		// An empty body, so an admitted request stops at the route's own
		// validation and creates nothing.
		const response = await fetch('/api/events', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				...headers(),
			},
			body: '{}',
		});
		const body = (await response.json()) as { message?: string };

		expect(response.status).toBe(status);
		expect(body.message === 'Cross-site request refused').toBe(status === 403);
	});

	it('still answers a cross-site read, which changes nothing and cannot be read back', async () => {
		const response = await fetch('/api/events', {
			headers: { 'sec-fetch-site': 'cross-site', origin: 'https://not-this-installation.example' },
		});

		expect(response.status).toBe(200);
	});

	it('answers 401 rather than 404 for a private path that does not exist', async () => {
		// Stated on its own because it is a deliberate consequence: the boundary
		// runs before the router, so a signed-out caller cannot use "Cannot
		// find any route matching" to map the API.
		const { message } = await anonymous('/api/events/1/screens/1/not-a-real-action', {
			method: 'POST',
		});

		expect(message).toBe(REFUSAL);
		expect(message).not.toContain('Cannot find any route matching');
	});
});

describe('the surfaces the boundary exempts', () => {
	it('answers the clock without a session, because output machines have none', async () => {
		const { status } = await anonymous('/api/time');

		expect(status).toBe(200);
	});

	// Sign-in is Keepr Accounts' (ADR-0141): Stream Keepr serves none of it, and
	// what used to be reachable without a Session is behind the boundary like any
	// path nobody wrote a route for.
	it.each([
		['POST', '/api/auth/sign-in/email'],
		['GET', '/api/auth/get-session'],
		['POST', '/api/bootstrap/ensure-admin'],
	])('exempts nothing of its former sign-in: %s %s', async (method, path) => {
		expect(await anonymous(path, { method })).toMatchObject({ status: 401, message: REFUSAL });
	});

	/**
	 * #397's half: the two allowlisted routes that used to answer anybody now refuse
	 * on their own terms, because being exempt from the *session* requirement is not
	 * being public.
	 *
	 * Both are checked anonymously and through the boundary's own suite rather than
	 * their features', because what is being established is the same property the rows
	 * above establish: a request carrying nothing gets nothing.
	 */
	it('refuses the Screen lookup by slug to a caller with neither credential', async () => {
		// One 404 for every way of not being allowed to ask, so it cannot be used to
		// find out which Screens exist. `screens.test.ts` covers the session arm and
		// the unit suite covers the bearer arm.
		const { status, message } = await anonymous(
			'/api/screen-output/events/1/screens/slug/anything',
		);

		expect(status).toBe(404);
		expect(message).toBe('Screen not found');
	});

	it('keeps the capability surface refusing 404, not 401', async () => {
		// The posture that must survive the boundary: a caller with no capability
		// learns nothing about whether the Screen or the asset exists. A 401 here
		// would hand back exactly the distinction the 404 withholds.
		const { status, message } = await anonymous(
			'/api/screen-output/screens/1/assets/nothing/revisions/nothing/content',
		);

		expect(status).toBe(404);
		expect(message).not.toBe(REFUSAL);
	});

	// The Graphics Administrator is a signed-in User holding the App role (ADR-0131):
	// no Session is the boundary's 401, a Session without the role the guard's 403.
	it('refuses an admin route with no Session, as it refuses every private route', async () => {
		const { status, message } = await anonymous('/api/admin/graphics-assets/health');

		expect(status).toBe(401);
		expect(message).toBe(REFUSAL);
	});

	it('refuses an admin route to a signed-in User whose App role is not admin', async () => {
		const response = await fetch('/api/admin/graphics-assets/health', {
			headers: { cookie: await aUserWithoutTheRole('api-boundary-no-role') },
		});
		const body = (await response.json()) as { data?: { code?: string } };

		expect(response.status).toBe(403);
		expect(body.data?.code).toBe('APP_ROLE_REQUIRED');
	});

	it('admits the Graphics Administrator to an admin route', async () => {
		expect((await fetch('/api/admin/graphics-assets/health')).status).toBe(200);
	});
});
