import type { InvitationKey, TestAccounts } from '~~/test/helpers/keeprAccounts';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { identityDatabase, schema } from '~~/server/db';
import {
	acceptInvitationAsNewUser,
	acceptInvitationSignedIn,
	declineInvitation,
	invitationOffer,
} from '~~/server/utils/invitationAcceptance';
import { cancelInvitation, inviteMember } from '~~/server/utils/invitations';
import {
	createTestAccounts,
	emailedInvitation,
	fakeBreachedPasswordService,
	fakeBreachedPasswordServiceDown,
	PASSWORD,
} from '~~/test/helpers/keeprAccounts';

// The invitee answers an Invitation with the secret its emailed link carries: with
// no User, by choosing a name and a password; with one, signed in. The id alone,
// which the inviter and every manager hold, answers nothing (ADR-0155).

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

/** Invites `email`: the Invitation as the link emailed to them names it. */
async function invite(
	appRoles: Record<string, string> = { stream: 'admin', score: 'member' },
	email = INVITEE,
): Promise<InvitationKey> {
	await inviteMember(
		database(),
		await accounts.actor(OWNER),
		{ organizationId: keepr.id, email, role: 'admin', appRoles },
		{ email: accounts.email, origin: 'http://localhost:3000' },
	);
	return emailedInvitation(accounts.email, email);
}

/** The Invitation's id, with a secret that is not its own: what its inviter or a manager holds. */
function idAlone({ invitationId }: InvitationKey): InvitationKey {
	return { invitationId, secret: '' };
}

function offer(key: InvitationKey) {
	return invitationOffer(accounts.auth, database(), key);
}

function acceptAsNew(key: InvitationKey, name = 'Newcomer', password = PASSWORD) {
	return acceptInvitationAsNewUser(accounts.auth, database(), { ...key, name, password });
}

/** A request the invitee's browser sends from Keepr Accounts' own page, with `cookie` when signed in. */
function pageRequest(path: string, headers: Record<string, string> = {}) {
	return new Request(`http://localhost:3000/api/invitation/${path}`, {
		method: 'POST',
		headers: { 'sec-fetch-site': 'same-origin', ...headers },
	});
}

async function acceptSignedIn(key: InvitationKey, email: string) {
	return await acceptInvitationSignedIn(
		accounts.auth,
		database(),
		key,
		pageRequest('accept-signed-in', { cookie: await accounts.signIn(email) }),
	);
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
		const key = await invite();

		expect(await offer(key)).toEqual({
			email: INVITEE,
			organisationName: 'Keepr',
			inviterName: 'owner',
			role: 'admin',
			appRoles: { stream: 'admin', score: 'member' },
			hasUser: false,
		});
	});

	it.each<[string, (key: InvitationKey) => InvitationKey]>([
		['an id no Invitation has', () => ({ invitationId: 'no-such-invitation', secret: 'none' })],
		['the id alone', idAlone],
		['a secret not its own', (key) => ({ ...key, secret: `${key.secret}x` })],
	])('is refused for %s, as for none', async (_case, presented) => {
		const key = await invite();

		await expect(offer(presented(key))).rejects.toMatchObject({
			statusCode: 404,
			code: 'INVITATION_NOT_FOUND',
		});
	});
});

describe('accepting as a new User', () => {
	it('creates one User with a verified email, signed in, a member with App access', async () => {
		const key = await invite();

		const { setCookie } = await acceptAsNew(key);

		const users = await usersCalled(INVITEE);
		expect(users).toEqual([expect.objectContaining({ name: 'Newcomer', emailVerified: true })]);
		expect(await signedInAs(setCookie)).toMatchObject({
			user: { email: INVITEE },
			session: { activeOrganizationId: keepr.id },
		});
		const member = await memberOf(INVITEE);
		expect(member).toMatchObject({ organizationId: keepr.id, role: 'admin' });
		const access = await database()
			.select({ app: schema.appAccess.app, role: schema.appAccess.role })
			.from(schema.appAccess)
			.where(eq(schema.appAccess.memberId, member!.id));
		expect(access.toSorted((a, b) => a.app.localeCompare(b.app))).toEqual([
			{ app: 'score', role: 'member' },
			{ app: 'stream', role: 'admin' },
		]);
	});

	it('names the User as they chose, trimmed', async () => {
		await acceptAsNew(await invite(), '  New Comer ');

		expect((await usersCalled(INVITEE)).map((user) => user.name)).toEqual(['New Comer']);
	});

	it('writes no App access for an App the Invitation left out', async () => {
		await acceptAsNew(await invite({}));

		expect(await database().select().from(schema.appAccess)).toEqual([]);
	});

	it('is in the Audit Record, with who accepted and when, and never the secret', async () => {
		const key = await invite({ stream: 'member' });

		await acceptAsNew(key);

		const [user] = await usersCalled(INVITEE);
		const record = await accounts.auditRecord();
		const accepted = record.filter((row) => row.action === 'invitation.accepted');
		expect(accepted).toEqual([
			expect.objectContaining({
				actorUserId: user!.id,
				subjectUserId: user!.id,
				organizationId: keepr.id,
				at: expect.any(Date),
			}),
		]);
		expect(JSON.parse(accepted[0]!.detail!)).toEqual({
			invitationId: key.invitationId,
			role: 'admin',
			appRoles: { stream: 'member' },
		});
		expect(JSON.stringify(record)).not.toContain(key.secret);
	});

	it('that fails before its Audit Record is written grants no App access', async () => {
		const key = await invite();
		await accounts.failInsertsInto('auditRecord');

		await expect(acceptAsNew(key)).rejects.toThrow(/injected failure/);

		expect(await database().select().from(schema.appAccess)).toEqual([]);
	});

	it('is admitted to an Organisation of more than the library’s hundred members', async () => {
		for (let n = 0; n < 100; n++) {
			const email = `member-${n}@keepr.digital`;
			const { id } = await accounts.createUser(email);
			await accounts.addMember(id, 'keepr');
		}

		await acceptAsNew(await invite());

		expect(await usersCalled(INVITEE)).toHaveLength(1);
	});
});

describe('accepting as a new User is refused', () => {
	it.each([
		['a password under the minimum', 'short', 400, 'PASSWORD_TOO_SHORT'],
		['a password from a breach', BREACHED, 400, 'PASSWORD_COMPROMISED'],
		['a blank name', PASSWORD, 400, 'NAME_REQUIRED'],
	])('for %s, creating nobody', async (_case, password, statusCode, code) => {
		const key = await invite();

		await expect(
			acceptAsNew(key, code === 'NAME_REQUIRED' ? '  ' : 'Newcomer', password),
		).rejects.toMatchObject({ statusCode, code });
		expect(await usersCalled(INVITEE)).toEqual([]);
	});

	it('while the breach check cannot be made, creating nobody', async () => {
		const key = await invite();
		fakeBreachedPasswordServiceDown();

		await expect(acceptAsNew(key)).rejects.toMatchObject({ statusCode: 500 });
		expect(await usersCalled(INVITEE)).toEqual([]);
	});

	it('to the holder of the id alone, creating nobody and leaving it open', async () => {
		const key = await invite();

		await expect(acceptAsNew(idAlone(key))).rejects.toMatchObject({
			statusCode: 404,
			code: 'INVITATION_NOT_FOUND',
		});
		expect(await usersCalled(INVITEE)).toEqual([]);
		await expect(offer(key)).resolves.toMatchObject({ email: INVITEE });
	});

	it('once the Invitation has been accepted', async () => {
		const key = await invite();
		await acceptAsNew(key);

		await expect(acceptAsNew(key)).rejects.toMatchObject({
			statusCode: 410,
			code: 'INVITATION_ACCEPTED',
		});
		expect(await usersCalled(INVITEE)).toHaveLength(1);
	});

	it('for an address that already has a User, who signs in to accept', async () => {
		await accounts.createUser(INVITEE);

		await expect(acceptAsNew(await invite())).rejects.toMatchObject({
			statusCode: 409,
			code: 'USER_ALREADY_EXISTS',
		});
	});
});

const DAY_MS = 24 * 60 * 60 * 1000;

async function closeBy(
	how: 'expiring' | 'cancelling' | 'accepting' | 'declining',
	key: InvitationKey,
) {
	switch (how) {
		case 'expiring':
			vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 8 * DAY_MS });
			return;
		case 'cancelling':
			await cancelInvitation(database(), await accounts.actor(OWNER), {
				organizationId: keepr.id,
				invitationId: key.invitationId,
			});
			return;
		case 'accepting':
			await acceptAsNew(key);
			return;
		case 'declining':
			await declineInvitation(accounts.auth, database(), key);
	}
}

function database() {
	return identityDatabase(accounts.harness.database);
}

async function memberOf(email: string) {
	const [user] = await usersCalled(email);
	const [member] = await database()
		.select()
		.from(schema.member)
		.where(and(eq(schema.member.userId, user!.id), eq(schema.member.organizationId, keepr.id)));
	return member;
}

describe('a closed Invitation', () => {
	afterEach(() => vi.useRealTimers());

	it.each([
		['expiring', 'INVITATION_EXPIRED'],
		['cancelling', 'INVITATION_CANCELLED'],
		['accepting', 'INVITATION_ACCEPTED'],
		['declining', 'INVITATION_DECLINED'],
	] as const)('says, after %s, that it is closed and why', async (how, code) => {
		const key = await invite();

		await closeBy(how, key);

		await expect(offer(key)).rejects.toMatchObject({ statusCode: 410, code });
	});

	it('says nothing of why to the holder of the id alone', async () => {
		const key = await invite();
		await closeBy('cancelling', key);

		await expect(offer(idAlone(key))).rejects.toMatchObject({
			statusCode: 404,
			code: 'INVITATION_NOT_FOUND',
		});
	});
});

describe('declining an Invitation', () => {
	it.each([
		['an address with no User', false],
		['an address that has a User', true],
	])('from its link, for %s, closes it and is in the Audit Record', async (_case, hasUser) => {
		const user = hasUser ? await accounts.createUser(INVITEE) : null;
		const key = await invite();

		await declineInvitation(accounts.auth, database(), key);

		await expect(offer(key)).rejects.toMatchObject({ code: 'INVITATION_DECLINED' });
		const declined = (await accounts.auditRecord()).filter(
			(row) => row.action === 'invitation.declined',
		);
		expect(declined).toEqual([
			expect.objectContaining({
				actorUserId: user?.id ?? null,
				subjectUserId: user?.id ?? null,
				organizationId: keepr.id,
			}),
		]);
		expect(JSON.parse(declined[0]!.detail!)).toEqual({
			invitationId: key.invitationId,
			email: INVITEE,
		});
	});

	it('is refused to the holder of the id alone, leaving it open', async () => {
		const key = await invite();

		await expect(declineInvitation(accounts.auth, database(), idAlone(key))).rejects.toMatchObject({
			statusCode: 404,
			code: 'INVITATION_NOT_FOUND',
		});
		await expect(offer(key)).resolves.toMatchObject({ email: INVITEE });
	});

	it('is refused once it has closed, leaving it as it was', async () => {
		const key = await invite();
		await closeBy('cancelling', key);

		await expect(declineInvitation(accounts.auth, database(), key)).rejects.toMatchObject({
			statusCode: 410,
			code: 'INVITATION_CANCELLED',
		});
		expect(
			(await accounts.auditRecord()).filter((row) => row.action === 'invitation.declined'),
		).toEqual([]);
	});
});

describe('accepting as an existing User', () => {
	it('adds the Organisation and its App access to their User, and works in it', async () => {
		const { id: userId } = await accounts.createUser(INVITEE);
		// Signed in, they work in the Organisation they already belong to.
		await accounts.addMember(userId, 'elsewhere');
		const key = await invite({ stream: 'admin' });
		const cookie = await accounts.signIn(INVITEE);

		await acceptInvitationSignedIn(
			accounts.auth,
			database(),
			key,
			pageRequest('accept-signed-in', { cookie }),
		);

		expect(await usersCalled(INVITEE)).toHaveLength(1);
		const member = await memberOf(INVITEE);
		expect(member).toMatchObject({ role: 'admin' });
		expect(
			await database()
				.select({ app: schema.appAccess.app, role: schema.appAccess.role })
				.from(schema.appAccess)
				.where(eq(schema.appAccess.memberId, member!.id)),
		).toEqual([{ app: 'stream', role: 'admin' }]);
		expect(await signedInAs([cookie])).toMatchObject({
			session: { activeOrganizationId: keepr.id },
		});
	});

	it.each<[string, string, (key: InvitationKey) => InvitationKey, number, string]>([
		[
			'signed in with another address',
			'someone-else@example.com',
			(key) => key,
			403,
			'YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION',
		],
		['holding the id alone', INVITEE, idAlone, 404, 'INVITATION_NOT_FOUND'],
	])('is refused to a User %s, changing nothing', async (_case, email, presented, status, code) => {
		await accounts.createUser(INVITEE);
		if (email !== INVITEE) await accounts.createUser(email);
		const key = await invite();

		await expect(acceptSignedIn(presented(key), email)).rejects.toMatchObject({
			statusCode: status,
			code,
		});
		expect(await memberOf(email)).toBeUndefined();
		await expect(offer(key)).resolves.toMatchObject({ email: INVITEE });
	});

	it('twice at once leaves one membership', async () => {
		const { id } = await accounts.createUser(INVITEE);
		const key = await invite();

		await Promise.allSettled([acceptSignedIn(key, INVITEE), acceptSignedIn(key, INVITEE)]);

		expect(
			await database().select().from(schema.member).where(eq(schema.member.userId, id)),
		).toHaveLength(1);
	});
});

describe('a membership', () => {
	// Held by the table itself, so no path that writes a member can make a second.
	it('is one per User and Organisation', async () => {
		const { id } = await accounts.createUser(INVITEE);
		await accounts.addMember(id, 'keepr');

		await expect(accounts.addMember(id, 'keepr')).rejects.toMatchObject({
			cause: { message: expect.stringContaining('UNIQUE') },
		});
		expect(
			await database().select().from(schema.member).where(eq(schema.member.userId, id)),
		).toHaveLength(1);
	});
});
