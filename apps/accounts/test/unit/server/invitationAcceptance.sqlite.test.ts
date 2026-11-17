import type { TestAccounts } from '~~/test/helpers/keeprAccounts';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { identityDatabase, schema } from '~~/server/db';
import { acceptInvitationAsNewUser, invitationOffer } from '~~/server/utils/invitationAcceptance';
import {
	createTestAccounts,
	fakeBreachedPasswordService,
	fakeBreachedPasswordServiceDown,
	PASSWORD,
} from '~~/test/helpers/keeprAccounts';

// A person with no User accepts an Invitation by choosing a name and a password:
// Keepr Accounts creates the User, signs them in and makes them a member, with the
// App access the Invitation offered.

const OWNER = 'owner@keepr.digital';
const INVITEE = 'newcomer@example.com';
const BREACHED = 'a-password-from-a-breach';

let accounts: TestAccounts;
let keepr: { id: string };

beforeEach(async () => {
	fakeBreachedPasswordService([BREACHED]);
	accounts = await createTestAccounts();
	await accounts.createUser(OWNER);
	keepr = await accounts.createOrganisation('Keepr', OWNER);
});

afterEach(async () => await accounts.harness.close());

async function invite(
	appRoles: Record<string, string> = { stream: 'admin', score: 'member' },
	email = INVITEE,
) {
	const response = await accounts.send('/organization/invite-member', {
		body: { email, role: 'admin', organizationId: keepr.id, appRoles: JSON.stringify(appRoles) },
		headers: { cookie: await accounts.signIn(OWNER) },
	});
	return ((await response.json()) as { id: string }).id;
}

async function usersCalled(email: string) {
	const database = identityDatabase(accounts.harness.database);
	return await database.select().from(schema.user).where(eq(schema.user.email, email));
}

async function signedInAs(setCookie: string[]) {
	const cookie = setCookie.map((value) => value.split(';')[0]).join('; ');
	const response = await accounts.send('/get-session', { headers: { cookie } });
	return (await response.json()) as {
		user: { email: string };
		session: { activeOrganizationId: string | null };
	} | null;
}

describe('the offer an invitee sees', () => {
	it('names who invited them, to which Organisation, and with what', async () => {
		const id = await invite();

		expect(await invitationOffer(accounts.auth, id)).toEqual({
			email: INVITEE,
			organisationName: 'Keepr',
			inviterName: 'owner',
			role: 'admin',
			appRoles: { stream: 'admin', score: 'member' },
			hasUser: false,
		});
	});

	it('is refused for an id no Invitation has', async () => {
		await expect(invitationOffer(accounts.auth, 'no-such-invitation')).rejects.toMatchObject({
			statusCode: 404,
			code: 'INVITATION_NOT_FOUND',
		});
	});
});

describe('accepting as a new User', () => {
	it('creates one User with a verified email, signed in, a member with App access', async () => {
		const id = await invite();

		const { setCookie } = await acceptInvitationAsNewUser(accounts.auth, {
			invitationId: id,
			name: 'Newcomer',
			password: PASSWORD,
		});

		const users = await usersCalled(INVITEE);
		expect(users).toEqual([expect.objectContaining({ name: 'Newcomer', emailVerified: true })]);
		expect(await signedInAs(setCookie)).toMatchObject({
			user: { email: INVITEE },
			session: { activeOrganizationId: keepr.id },
		});
		const database = identityDatabase(accounts.harness.database);
		const [member] = await database
			.select()
			.from(schema.member)
			.where(eq(schema.member.userId, users[0]!.id));
		expect(member).toMatchObject({ organizationId: keepr.id, role: 'admin' });
		const access = await database
			.select({ app: schema.appAccess.app, role: schema.appAccess.role })
			.from(schema.appAccess)
			.where(eq(schema.appAccess.memberId, member!.id));
		expect(access.toSorted((a, b) => a.app.localeCompare(b.app))).toEqual([
			{ app: 'score', role: 'member' },
			{ app: 'stream', role: 'admin' },
		]);
	});

	it('writes no App access for an App the Invitation left out', async () => {
		const id = await invite({});

		await acceptInvitationAsNewUser(accounts.auth, {
			invitationId: id,
			name: 'Newcomer',
			password: PASSWORD,
		});

		const database = identityDatabase(accounts.harness.database);
		expect(await database.select().from(schema.appAccess)).toEqual([]);
	});

	it('is in the Audit Record, with who accepted and when', async () => {
		const id = await invite({ stream: 'member' });

		await acceptInvitationAsNewUser(accounts.auth, {
			invitationId: id,
			name: 'Newcomer',
			password: PASSWORD,
		});

		const [user] = await usersCalled(INVITEE);
		const accepted = (await accounts.auditRecord()).filter(
			(row) => row.action === 'invitation.accepted',
		);
		expect(accepted).toEqual([
			expect.objectContaining({
				actorUserId: user!.id,
				subjectUserId: user!.id,
				organizationId: keepr.id,
				at: expect.any(Date),
			}),
		]);
		expect(JSON.parse(accepted[0]!.detail!)).toEqual({
			invitationId: id,
			role: 'admin',
			appRoles: { stream: 'member' },
		});
	});

	it('is admitted to an Organisation of more than the library’s hundred members', async () => {
		for (let n = 0; n < 100; n++) {
			const email = `member-${n}@keepr.digital`;
			const { id } = await accounts.createUser(email);
			await accounts.addMember(id, 'keepr');
		}
		const id = await invite();

		await acceptInvitationAsNewUser(accounts.auth, {
			invitationId: id,
			name: 'Newcomer',
			password: PASSWORD,
		});

		expect(await usersCalled(INVITEE)).toHaveLength(1);
	});
});

describe('accepting as a new User is refused', () => {
	it.each([
		['a password under the minimum', 'short', 400, 'PASSWORD_TOO_SHORT'],
		['a password from a breach', BREACHED, 400, 'PASSWORD_COMPROMISED'],
		['a blank name', PASSWORD, 400, 'NAME_REQUIRED'],
	])('for %s, creating nobody', async (_case, password, statusCode, code) => {
		const id = await invite();

		await expect(
			acceptInvitationAsNewUser(accounts.auth, {
				invitationId: id,
				name: code === 'NAME_REQUIRED' ? '  ' : 'Newcomer',
				password,
			}),
		).rejects.toMatchObject({ statusCode, code });
		expect(await usersCalled(INVITEE)).toEqual([]);
	});

	it('while the breach check cannot be made, creating nobody', async () => {
		const id = await invite();
		fakeBreachedPasswordServiceDown();

		await expect(
			acceptInvitationAsNewUser(accounts.auth, {
				invitationId: id,
				name: 'Newcomer',
				password: PASSWORD,
			}),
		).rejects.toMatchObject({ statusCode: 500 });
		expect(await usersCalled(INVITEE)).toEqual([]);
	});

	it('once the Invitation has been accepted', async () => {
		const id = await invite();
		const input = { invitationId: id, name: 'Newcomer', password: PASSWORD };
		await acceptInvitationAsNewUser(accounts.auth, input);

		await expect(acceptInvitationAsNewUser(accounts.auth, input)).rejects.toMatchObject({
			statusCode: 404,
			code: 'INVITATION_NOT_FOUND',
		});
		expect(await usersCalled(INVITEE)).toHaveLength(1);
	});

	it('for an address that already has a User, who signs in to accept', async () => {
		await accounts.createUser(INVITEE);
		const id = await invite();

		await expect(
			acceptInvitationAsNewUser(accounts.auth, {
				invitationId: id,
				name: 'Newcomer',
				password: PASSWORD,
			}),
		).rejects.toMatchObject({ statusCode: 409, code: 'USER_ALREADY_EXISTS' });
	});
});
