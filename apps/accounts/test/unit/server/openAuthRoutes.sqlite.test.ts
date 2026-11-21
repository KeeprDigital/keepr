import type { TestAccounts } from '~~/test/helpers/keeprAccounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OPEN_AUTH_ROUTES } from '~~/server/utils/openAuthRoutes';
import {
	cookiesOf,
	createTestAccounts,
	fakeBreachedPasswordService,
	PASSWORD,
} from '~~/test/helpers/keeprAccounts';

// Better Auth's routes are closed but for a checked-in list: every route the
// library ships answers 404 unless Keepr Accounts leaves it open, so a library
// upgrade that adds one is closed, and goes red here until it is placed.

interface RoutedEndpoint {
	path?: string;
	options?: { method?: string | string[] };
}

// Built before the cases are, which are read from it.
const accounts: TestAccounts = await createTestAccounts();

beforeAll(async () => {
	fakeBreachedPasswordService();
	await accounts.createUser('administrator@keepr.digital', { role: 'admin' });
});

afterAll(async () => await accounts.harness.close());

let clients = 0;

/** Signs `email` in from a client of its own, so no rate limit is met: the cookie answered. */
async function signedIn(email: string) {
	const response = await accounts.send('/sign-in/email', {
		body: { email, password: PASSWORD },
		headers: { 'cf-connecting-ip': `192.0.2.${(clients += 1)}` },
	});
	expect(response.status).toBe(200);
	return cookiesOf(response);
}

/** Every route the built instance serves, read from the instance itself, with a method each answers. */
function shippedRoutes() {
	return Object.values(accounts.auth.api as Record<string, RoutedEndpoint>)
		.filter((endpoint) => endpoint.path)
		.map((endpoint) => [[endpoint.options?.method ?? 'POST'].flat()[0]!, endpoint.path!] as const);
}

describe('every route the library ships', () => {
	// The whole list, so an upgrade that adds, renames or removes a route is seen.
	it('is the list this check was written against', () => {
		expect(
			shippedRoutes()
				.map(([, path]) => path)
				.toSorted(),
		).toEqual(
			[
				'/sign-in/social',
				'/callback/:id',
				'/get-session',
				'/sign-out',
				'/sign-up/email',
				'/sign-in/email',
				'/reset-password',
				'/verify-password',
				'/verify-email',
				'/send-verification-email',
				'/change-email',
				'/change-password',
				'/update-session',
				'/update-user',
				'/delete-user',
				'/request-password-reset',
				'/reset-password/:token',
				'/list-sessions',
				'/revoke-session',
				'/revoke-sessions',
				'/revoke-other-sessions',
				'/link-social',
				'/list-accounts',
				'/delete-user/callback',
				'/unlink-account',
				'/refresh-token',
				'/get-access-token',
				'/account-info',
				'/admin/set-role',
				'/admin/get-user',
				'/admin/create-user',
				'/admin/update-user',
				'/admin/list-users',
				'/admin/list-user-sessions',
				'/admin/unban-user',
				'/admin/ban-user',
				'/admin/impersonate-user',
				'/admin/stop-impersonating',
				'/admin/revoke-user-session',
				'/admin/revoke-user-sessions',
				'/admin/remove-user',
				'/admin/set-user-password',
				'/admin/has-permission',
				'/organization/create',
				'/organization/update',
				'/organization/delete',
				'/organization/set-active',
				'/organization/get-organization',
				'/organization/get-full-organization',
				'/organization/list',
				'/organization/invite-member',
				'/organization/cancel-invitation',
				'/organization/accept-invitation',
				'/organization/get-invitation',
				'/organization/reject-invitation',
				'/organization/list-invitations',
				'/organization/get-active-member',
				'/organization/check-slug',
				'/organization/remove-member',
				'/organization/update-member-role',
				'/organization/leave',
				'/organization/list-user-invitations',
				'/organization/list-members',
				'/organization/get-active-member-role',
				'/organization/has-permission',
				'/jwks',
				'/token',
				'/ok',
				'/error',
			].toSorted(),
		);
	});

	it('includes every route left open, so none is open by a name the library has not got', () => {
		const shipped = new Set(shippedRoutes().map(([, path]) => path));
		expect([...OPEN_AUTH_ROUTES].filter((path) => !shipped.has(path))).toEqual([]);
	});

	// Asked by a Keepr Administrator, whom the library's own administrator routes
	// would admit to everything.
	it.each(shippedRoutes())('%s %s answers 404 unless it is left open', async (method, path) => {
		const cookie = await signedIn('administrator@keepr.digital');

		const response = await accounts.send(path.replace(':id', 'x').replace(':token', 'x'), {
			method,
			headers: { cookie },
			...(method === 'GET' ? {} : { body: {} }),
		});

		expect(response.status === 404).toBe(!OPEN_AUTH_ROUTES.has(path));
	});

	it.each([
		['with a trailing slash', '/sign-up/email/'],
		['under a path the library matches by pattern', '/reset-password/a-token'],
		['under the library’s base path alone', ''],
	])('a closed route asked %s answers 404', async (_case, path) => {
		const response = await accounts.send(path, {
			body: { email: 'walk-in@keepr.digital', password: PASSWORD, name: 'Walk In' },
		});

		expect(response.status).toBe(404);
	});
});

// No open route tells a signed-in User which Organisations exist.
describe('switching the Organisation a Session works in', () => {
	let elsewhere: string;
	let cookie: string;

	beforeAll(async () => {
		await accounts.createUser('owner@club.example');
		elsewhere = (await accounts.createOrganisation('Elsewhere', 'owner@club.example')).id;
		await accounts.createUser('outsider@keepr.digital');
		cookie = await signedIn('outsider@keepr.digital');
	});

	it('is refused by slug, whether or not the slug is an Organisation’s', async () => {
		const answers = await Promise.all(
			['elsewhere', 'nowhere'].map(async (organizationSlug) => {
				const response = await accounts.send('/organization/set-active', {
					body: { organizationSlug },
					headers: { cookie },
				});
				return [response.status, ((await response.json()) as { code: string }).code];
			}),
		);

		expect(answers).toEqual([
			[400, 'ORGANISATION_ID_REQUIRED'],
			[400, 'ORGANISATION_ID_REQUIRED'],
		]);
	});

	it('answers an Organisation they are not in as one there is not', async () => {
		const answers = await Promise.all(
			[elsewhere, 'no-such-organisation'].map(async (organizationId) => {
				const response = await accounts.send('/organization/set-active', {
					body: { organizationId },
					headers: { cookie },
				});
				return [response.status, ((await response.json()) as { code: string }).code];
			}),
		);

		expect(answers[0]).toEqual(answers[1]);
		expect(answers[0]![0]).toBe(403);
	});
});

// A disabled User is refused on every route, not only where an Identity Proof is
// minted: their Session is ended the first time it is used.
describe('a disabled User whose Session was left open', () => {
	let n = 0;

	async function disabledUsersCookie() {
		const email = `disabled-${(n += 1)}@keepr.digital`;
		const { id } = await accounts.createUser(email);
		const cookie = await signedIn(email);
		await (await accounts.auth.$context).internalAdapter.updateUser(id, { banned: true });
		return cookie;
	}

	it.each([
		['GET', '/token', 401],
		['POST', '/update-user', 401],
		['GET', '/get-session', 200],
	])('%s %s answers %s, as signed out, and ends the Session', async (method, path, status) => {
		const cookie = await disabledUsersCookie();

		const response = await accounts.send(path, {
			method,
			headers: { cookie },
			...(method === 'GET' ? {} : { body: { name: 'Renamed' } }),
		});

		expect(response.status).toBe(status);
		const session = await accounts.send('/get-session', { headers: { cookie } });
		expect(await session.json()).toBeNull();
	});
});
