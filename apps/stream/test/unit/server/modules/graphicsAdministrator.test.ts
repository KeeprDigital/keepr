import { describe, expect, it } from 'vitest';
import {
	A_MEMBER,
	AN_ADMINISTRATOR,
	AN_OUTSIDER,
	keeprAccountsBinding,
	SIGNED_OUT,
	stubServerGlobals,
	workerRequest,
} from '~~/test/helpers/keeprAccounts';

// The Graphics Administrator is the `admin` App role, read from the request's
// Identity Proof (ADR-0131, ADR-0141). Keepr Accounts is stood in for by the
// Accounts Stand-in behind the Worker's binding.

stubServerGlobals();

const env = { KEEPR_ACCOUNTS: keeprAccountsBinding() };
const { requireGraphicsAdministrator } = await import('~~/server/modules/graphics-administrator');

describe('the Graphics Administrator guard', () => {
	it('admits a User whose Identity Proof names the admin App role, answering who they are', async () => {
		await expect(
			requireGraphicsAdministrator(workerRequest({ as: AN_ADMINISTRATOR, env })),
		).resolves.toBe('grace');
	});

	it.each([
		['a User whose App role is not admin', A_MEMBER, 403, 'APP_ROLE_REQUIRED'],
		['a User with no App access', AN_OUTSIDER, 403, 'NO_APP_ACCESS'],
		// A role only Keepr Accounts' newer App registry knows grants nothing here.
		[
			'a User whose App role this build does not know',
			{ user: 'mallory', apps: { stream: 'superadmin' } },
			403,
			'NO_APP_ACCESS',
		],
	])('refuses %s', async (_case, as, statusCode, code) => {
		await expect(requireGraphicsAdministrator(workerRequest({ as, env }))).rejects.toMatchObject({
			statusCode,
			data: { code },
		});
	});

	it("refuses a request with no Session in the boundary's own words", async () => {
		await expect(
			requireGraphicsAdministrator(workerRequest({ as: SIGNED_OUT, env })),
		).rejects.toMatchObject({ statusCode: 401, message: 'Authentication is required' });
	});
});
