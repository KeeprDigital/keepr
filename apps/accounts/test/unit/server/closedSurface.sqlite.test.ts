import type { TestAccounts } from '~~/test/helpers/keeprAccounts';
import { admin, jwt } from 'better-auth/plugins';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	createTestAccounts,
	fakeBreachedPasswordService,
	PASSWORD,
} from '~~/test/helpers/keeprAccounts';

// Nobody signs themselves up, and the library's administrator routes answer nobody,
// a Keepr Administrator included: Keepr Accounts serves narrower routes of its own.

interface RoutedEndpoint {
	path?: string;
	options?: { method?: string | string[] };
}

/** Every route an add-on ships, read from the add-on itself. */
function routesOf(plugin: { endpoints: unknown }) {
	return Object.values(plugin.endpoints as Record<string, RoutedEndpoint>)
		.filter((endpoint) => endpoint.path)
		.flatMap((endpoint) =>
			[endpoint.options?.method ?? 'POST']
				.flat()
				.map((method) => [method, endpoint.path!] as const),
		);
}

const adminRoutes = routesOf(admin());
// The signed-token routes stay closed until the Identity Proof is built on them.
const signedTokenRoutes = routesOf(jwt());

let accounts: TestAccounts;
let administratorCookie: string;

beforeAll(async () => {
	fakeBreachedPasswordService();
	accounts = await createTestAccounts();
	await accounts.createUser('administrator@keepr.digital', { role: 'admin' });
	administratorCookie = await accounts.signIn('administrator@keepr.digital');
});

afterAll(async () => await accounts.harness.close());

describe('self sign-up', () => {
	it('is refused', async () => {
		const response = await accounts.send('/sign-up/email', {
			body: { email: 'walk-in@keepr.digital', password: PASSWORD, name: 'Walk In' },
		});

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ code: 'EMAIL_PASSWORD_SIGN_UP_DISABLED' });
	});
});

describe('the library routes Keepr Accounts closes', () => {
	it('are read from the add-ons, so this cannot pass by asking nothing', () => {
		expect(adminRoutes.map(([, path]) => path)).toEqual(
			expect.arrayContaining(['/admin/impersonate-user', '/admin/remove-user', '/admin/set-role']),
		);
		expect(signedTokenRoutes.map(([, path]) => path)).toEqual(
			expect.arrayContaining(['/token', '/jwks']),
		);
	});

	it('are asked by a Session the library itself admits as an administrator', async () => {
		const response = await accounts.send('/get-session', {
			headers: { cookie: administratorCookie },
		});

		expect(await response.json()).toMatchObject({ user: { role: 'admin' } });
	});

	it.each([...adminRoutes, ...signedTokenRoutes])('%s %s answers 404', async (method, path) => {
		const response = await accounts.send(path, {
			method,
			headers: { cookie: administratorCookie },
			...(method === 'GET' ? {} : { body: {} }),
		});

		expect(response.status).toBe(404);
	});
});
