import type { TestAccounts } from '~~/test/helpers/keeprAccounts';
import { decodeJwt } from 'jose';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { identityDatabase } from '~~/server/db';
import { profileOrganisations } from '~~/server/utils/profileOrganisations';
import { createTestAccounts, fakeBreachedPasswordService } from '~~/test/helpers/keeprAccounts';

// A User's own Organisations, the Apps they can use in each, and the one they work
// in, which they switch on the Session: request in, response out.

const EMAIL = 'ada@keepr.digital';

let accounts: TestAccounts;
let userId: string;

beforeEach(async () => {
	fakeBreachedPasswordService();
	accounts = await createTestAccounts();
	({ id: userId } = await accounts.createUser(EMAIL));
});

afterEach(async () => await accounts.harness.close());

async function organisationsOf(cookie: string) {
	return await profileOrganisations(
		accounts.auth,
		identityDatabase(accounts.harness.database),
		new Headers({ cookie }),
	);
}

async function switchTo(cookie: string, organizationId: string) {
	return await accounts.send('/organization/set-active', {
		body: { organizationId },
		headers: { cookie },
	});
}

async function identityProof(cookie: string) {
	const response = await accounts.send('/token', { headers: { cookie } });
	return decodeJwt(((await response.json()) as { token: string }).token);
}

describe('the profile’s Organisations', () => {
	it('lists each with the Organisation role and App roles, and which is worked in', async () => {
		const keepr = await accounts.addMember(userId, 'keepr', {
			role: 'owner',
			apps: { stream: 'admin', score: 'member' },
		});
		const club = await accounts.addMember(userId, 'club', { role: 'member' });
		await accounts.addMember((await accounts.createUser('bo@keepr.digital')).id, 'other');

		expect(await organisationsOf(await accounts.signIn(EMAIL))).toEqual({
			active: keepr.organizationId,
			organisations: [
				{
					id: keepr.organizationId,
					name: 'keepr',
					role: 'owner',
					apps: { stream: 'admin', score: 'member' },
				},
				{ id: club.organizationId, name: 'club', role: 'member', apps: {} },
			],
		});
	});

	it('is refused to a visitor with no Session', async () => {
		await expect(organisationsOf('')).rejects.toMatchObject({ statusCode: 401 });
	});
});

describe('switching the Organisation worked in', () => {
	it('carries it on the Session and into the Identity Proof', async () => {
		await accounts.addMember(userId, 'keepr', { role: 'owner', apps: { stream: 'admin' } });
		const club = await accounts.addMember(userId, 'club', {
			role: 'member',
			apps: { score: 'member' },
		});
		const cookie = await accounts.signIn(EMAIL);

		expect((await switchTo(cookie, club.organizationId)).status).toBe(200);

		expect((await organisationsOf(cookie)).active).toBe(club.organizationId);
		expect(await identityProof(cookie)).toMatchObject({
			org: club.organizationId,
			orgRole: 'member',
			apps: { score: 'member' },
		});
	});

	it('is refused to an Organisation the User is not a member of', async () => {
		await accounts.addMember(userId, 'keepr');
		const other = await accounts.addMember(
			(await accounts.createUser('bo@keepr.digital')).id,
			'other',
		);
		const cookie = await accounts.signIn(EMAIL);

		expect((await switchTo(cookie, other.organizationId)).status).toBe(403);
		expect((await identityProof(cookie)).org).not.toBe(other.organizationId);
	});
});
