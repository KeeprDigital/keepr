import type { IdentityDatabase } from '~~/server/db';
import type { Actor } from '~~/server/utils/actor';
import type { NewInvitation } from '~~/server/utils/invitations';
import type { KeeprRefusal } from '~~/server/utils/refusal';
import type { OrganisationRole, TestAccounts } from '~~/test/helpers/keeprAccounts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { identityDatabase, schema } from '~~/server/db';
import { requestActor } from '~~/server/utils/actor';
import { INVITATION_LIMIT, INVITATIONS_PER_INVITER_PER_HOUR } from '~~/server/utils/authOptions';
import {
	cancelInvitation,
	inviteMember,
	listPendingInvitations,
} from '~~/server/utils/invitations';
import { RECENT_SIGN_IN_MS } from '~~/server/utils/recentSignIn';
import {
	createTestAccounts,
	emailedInvitation,
	fakeBreachedPasswordService,
} from '~~/test/helpers/keeprAccounts';

// An owner or admin, or a Keepr Administrator, invites an email address to an
// Organisation with an Organisation role and an App role per App, sees its pending
// Invitations and cancels one: request in, outcome out.

const OWNER = 'owner@keepr.digital';
const INVITEE = 'newcomer@example.com';
const ORIGIN = 'http://localhost:3000';
const DAY_MS = 24 * 60 * 60 * 1000;

let accounts: TestAccounts;
let database: IdentityDatabase;
let keepr: { id: string };

beforeEach(async () => {
	actors.clear();
	fakeBreachedPasswordService();
	accounts = await createTestAccounts();
	database = identityDatabase(accounts.harness.database);
	await accounts.createUser(OWNER);
	keepr = await accounts.createOrganisation('Keepr', OWNER);
});

afterEach(async () => {
	vi.useRealTimers();
	await accounts.harness.close();
});

const actors = new Map<string, Actor>();

/** The Actor a browser signed in as `email` is, from Keepr Accounts' own page: one sign-in each. */
async function actorFor(email: string) {
	const known = actors.get(email);
	if (known) return known;
	const actor = await requestActor(
		accounts.auth,
		new Request(`${ORIGIN}/api/organisations/keepr/invitations`, {
			method: 'POST',
			headers: { cookie: await accounts.signIn(email), 'sec-fetch-site': 'same-origin' },
		}),
	);
	actors.set(email, actor);
	return actor;
}

/** A User of their own holding `role` in the Keepr Organisation: their address. */
async function holding(role: OrganisationRole) {
	if (role === 'owner') return OWNER;
	const email = `${role}-${crypto.randomUUID()}@keepr.digital`;
	const { id } = await accounts.createUser(email);
	await accounts.addMember(id, 'keepr', { role });
	return email;
}

/** A Keepr Administrator who is no member of the Keepr Organisation: their address. */
async function keeprAdministrator() {
	const email = `administrator-${crypto.randomUUID()}@keepr.digital`;
	await accounts.createUser(email, { role: 'admin' });
	return email;
}

async function invite(email: string, invitation: Partial<NewInvitation> = {}, sender = accounts) {
	return await inviteMember(
		database,
		await actorFor(email),
		{ organizationId: keepr.id, email: INVITEE, role: 'member', ...invitation },
		{ email: sender.email, origin: ORIGIN },
	);
}

/** What `work` answers, or the code and status it was refused with. */
async function outcome<T>(work: Promise<T>): Promise<T | { refused: string; statusCode: number }> {
	try {
		return await work;
	} catch (error) {
		const { code, statusCode } = error as KeeprRefusal;
		return { refused: code, statusCode };
	}
}

async function invitationRow(id: string) {
	const ctx = await accounts.auth.$context;
	return await ctx.adapter.findOne<{
		role: string;
		status: string;
		appRoles: string | null;
		expiresAt: Date;
	}>({ model: 'invitation', where: [{ field: 'id', value: id }] });
}

async function invitations() {
	return await (await accounts.auth.$context).adapter.count({ model: 'invitation' });
}

/** The Audit Record's rows for `action`, their detail read. */
async function audited(action: string) {
	return (await accounts.auditRecord())
		.filter((row) => row.action === action)
		.map((row) => ({ ...row, detail: row.detail === null ? null : JSON.parse(row.detail) }));
}

async function userIdOf(email: string) {
	return (await (await accounts.auth.$context).internalAdapter.findUserByEmail(email))!.user.id;
}

describe('an Invitation', () => {
	it('carries the Organisation role and the App roles, and lasts seven days', async () => {
		vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-17T10:00:00Z') });

		const { invitationId } = await invite(OWNER, {
			role: 'admin',
			appRoles: { stream: 'admin', score: 'member' },
		});

		const row = await invitationRow(invitationId);
		expect(row).toMatchObject({ role: 'admin', status: 'pending' });
		expect(JSON.parse(row!.appRoles!)).toEqual({ stream: 'admin', score: 'member' });
		expect(row!.expiresAt.getTime()).toBe(Date.parse('2026-11-17T10:00:00Z') + 7 * DAY_MS);
	});

	it('is emailed to the invitee, naming who invited them, to what, with its link', async () => {
		const { invitationId } = await invite(OWNER);

		expect(accounts.email.sent).toHaveLength(1);
		const [sent] = accounts.email.sent;
		expect(sent!.to).toBe(INVITEE);
		expect(sent!.subject).toContain('Keepr');
		expect(sent!.text).toContain('owner');
		const { secret } = emailedInvitation(accounts.email, INVITEE);
		expect(sent!.text).toContain(`${ORIGIN}/invitation#id=${invitationId}&secret=${secret}`);
	});

	// The secret is the invitee's proof: whoever else holds the id must not hold it.
	it('keeps its link’s secret from the inviter, the managers’ listing and the Audit Record', async () => {
		const answered = await invite(OWNER);
		const { secret } = emailedInvitation(accounts.email, INVITEE);

		const seen = JSON.stringify([
			answered,
			await pending(OWNER),
			await accounts.auditRecord(),
			await database.select().from(schema.invitationSecret),
		]);

		expect(secret.length).toBeGreaterThanOrEqual(32);
		expect(seen).not.toContain(secret);
	});

	it('is created, its link answered, when sending the email fails', async () => {
		const sending: Promise<unknown>[] = [];

		const { invitationId } = await inviteMember(
			database,
			await actorFor(OWNER),
			{ organizationId: keepr.id, email: INVITEE, role: 'member' },
			{
				email: { send: async () => await Promise.reject(new Error('the email service is down')) },
				origin: ORIGIN,
				afterResponse: (work) => sending.push(work.catch(() => undefined)),
			},
		);
		await Promise.all(sending);

		expect(await invitationRow(invitationId)).toMatchObject({ status: 'pending' });
	});

	it('is in the Audit Record, with who invited whom, with what, and as what', async () => {
		const { invitationId } = await invite(OWNER, { appRoles: { stream: 'member' } });

		expect(await audited('invitation.created')).toEqual([
			expect.objectContaining({
				actorUserId: await userIdOf(OWNER),
				organizationId: keepr.id,
				at: expect.any(Date),
				detail: {
					invitationId,
					email: INVITEE,
					role: 'member',
					appRoles: { stream: 'member' },
					as: 'owner',
				},
			}),
		]);
	});
});

describe('an Invitation is refused, and nothing is invited or emailed', () => {
	it.each<[string, Partial<NewInvitation>, string, number]>([
		[
			'for an App the registry does not name',
			{ appRoles: { chess: 'member' } },
			'APP_ROLE_NOT_IN_REGISTRY',
			400,
		],
		[
			'for a role the App does not define',
			{ appRoles: { stream: 'owner' } },
			'APP_ROLE_NOT_IN_REGISTRY',
			400,
		],
		[
			'for anything but an App-to-role map',
			{ appRoles: ['stream'] },
			'APP_ROLE_NOT_IN_REGISTRY',
			400,
		],
		['to an address that is none', { email: 'nobody' }, 'INVALID_EMAIL', 400],
		['to an address with no domain to mail', { email: 'a@b' }, 'INVALID_EMAIL', 400],
		['to more than one address', { email: 'a,b@c.example' }, 'INVALID_EMAIL', 400],
		[
			'as an Organisation role there is none of',
			{ role: 'chair' },
			'ORGANISATION_ROLE_NOT_KNOWN',
			400,
		],
		['to an address already a member', { email: OWNER }, 'ALREADY_A_MEMBER', 409],
	])('%s', async (_case, invitation, refused, statusCode) => {
		expect(await outcome(invite(OWNER, invitation))).toEqual({ refused, statusCode });
		expect(await invitations()).toBe(0);
		expect(accounts.email.sent).toEqual([]);
	});

	it(`past ${INVITATION_LIMIT} pending in the Organisation`, async () => {
		const now = new Date();
		const inviterId = await userIdOf(OWNER);
		const expiresAt = new Date(now.getTime() + DAY_MS);
		const rows = Array.from({ length: INVITATION_LIMIT - 1 }, (_, n) => ({
			id: `pending-${n}`,
			organizationId: keepr.id,
			email: `invitee-${n}@example.com`,
			role: 'member',
			status: 'pending',
			expiresAt,
			// Made over an hour ago, so the inviter's hourly cap leaves room.
			createdAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
			inviterId,
		}));
		for (let at = 0; at < rows.length; at += 500)
			await database.insert(schema.invitation).values(rows.slice(at, at + 500));

		expect(await outcome(invite(OWNER, { email: 'last@example.com' }))).toMatchObject({
			invitationId: expect.any(String),
		});
		expect(await outcome(invite(OWNER, { email: 'one-more@example.com' }))).toEqual({
			refused: 'INVITATION_LIMIT_REACHED',
			statusCode: 403,
		});
	});
});

describe('who may invite', () => {
	it.each<[string, () => Promise<string>, OrganisationRole, string | null]>([
		['an owner', () => holding('owner'), 'owner', null],
		['an admin', () => holding('admin'), 'admin', null],
		['an admin', () => holding('admin'), 'owner', 'OWNER_REQUIRED'],
		['a member', () => holding('member'), 'member', 'NOT_A_MANAGER'],
		// Story 48: one who is no member at all invites as an owner would.
		['a Keepr Administrator', keeprAdministrator, 'owner', null],
	])('%s inviting an %s is refused: %s', async (_who, inviter, role, refused) => {
		const answered = await outcome(invite(await inviter(), { role }));

		expect((answered as { refused?: string }).refused ?? null).toBe(refused);
		expect(await invitations()).toBe(refused === null ? 1 : 0);
	});
});

async function cancel(email: string, invitationId: string, organizationId = keepr.id) {
	return await cancelInvitation(database, await actorFor(email), { organizationId, invitationId });
}

async function pending(email: string) {
	return await listPendingInvitations(database, await actorFor(email), keepr.id);
}

describe('the pending Invitations', () => {
	it('are listed with who and what each offers, and none that has closed', async () => {
		vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-17T10:00:00Z') });
		await invite(OWNER, { email: 'lapsed@example.com' });
		vi.setSystemTime(new Date('2026-11-25T10:00:00Z'));
		// A week on, they have signed in again.
		actors.clear();
		const { invitationId: gone } = await invite(OWNER, { email: 'gone@example.com' });
		await cancel(OWNER, gone);
		const { invitationId } = await invite(OWNER, { role: 'admin', appRoles: { stream: 'member' } });

		expect(await pending(OWNER)).toEqual([
			{
				id: invitationId,
				email: INVITEE,
				role: 'admin',
				appRoles: { stream: 'member' },
				inviterName: 'owner',
				expiresAt: '2026-12-02T10:00:00.000Z',
			},
		]);
	});

	it.each<[string, () => Promise<string>, string[]]>([
		['to an admin, but not an owner’s offer to an owner', () => holding('admin'), [INVITEE]],
		[
			'to a Keepr Administrator, every one',
			keeprAdministrator,
			['next-owner@example.com', INVITEE],
		],
	])('are listed %s', async (_case, viewer, emails) => {
		await invite(OWNER, { email: 'next-owner@example.com', role: 'owner' });
		await invite(OWNER);

		expect((await pending(await viewer())).map(({ email }) => email)).toEqual(emails);
	});

	it('are refused to a member', async () => {
		expect(await outcome(pending(await holding('member')))).toEqual({
			refused: 'NOT_A_MANAGER',
			statusCode: 403,
		});
	});
});

describe('cancelling an Invitation', () => {
	it.each<[string, () => Promise<string>, OrganisationRole, string | null]>([
		['an admin', () => holding('admin'), 'member', null],
		['a member', () => holding('member'), 'member', 'NOT_A_MANAGER'],
		['an admin', () => holding('admin'), 'owner', 'OWNER_REQUIRED'],
		['a Keepr Administrator', keeprAdministrator, 'owner', null],
	])('by %s, of an offer to an %s, is refused: %s', async (_who, canceller, role, refused) => {
		const { invitationId } = await invite(OWNER, { role });

		const answered = await outcome(cancel(await canceller(), invitationId));

		expect(answered).toEqual(refused === null ? undefined : { refused, statusCode: 403 });
		expect((await invitationRow(invitationId))!.status).toBe(
			refused === null ? 'canceled' : 'pending',
		);
	});

	it('is in the Audit Record, with who cancelled which, and as what', async () => {
		const administrator = await keeprAdministrator();
		const { invitationId } = await invite(OWNER);

		await cancel(administrator, invitationId);

		expect(await audited('invitation.cancelled')).toEqual([
			expect.objectContaining({
				actorUserId: await userIdOf(administrator),
				organizationId: keepr.id,
				detail: { invitationId, email: INVITEE, as: 'keepr-administrator' },
			}),
		]);
	});

	it('is refused once it has been accepted, leaving it accepted', async () => {
		await accounts.createUser(INVITEE);
		const { invitationId } = await invite(OWNER);
		await accounts.auth.api.acceptInvitation({
			body: { invitationId },
			headers: new Headers({ cookie: await accounts.signIn(INVITEE) }),
		});

		expect(await outcome(cancel(OWNER, invitationId))).toEqual({
			refused: 'INVITATION_NOT_PENDING',
			statusCode: 400,
		});
		expect((await invitationRow(invitationId))!.status).toBe('accepted');
		expect(await audited('invitation.cancelled')).toEqual([]);
	});

	it('of another Organisation’s, named under this one, is refused as none', async () => {
		const { invitationId } = await invite(OWNER);
		const { id } = await accounts.createUser('elsewhere@example.com');
		const { organizationId } = await accounts.addMember(id, 'elsewhere', { role: 'owner' });

		expect(await outcome(cancel('elsewhere@example.com', invitationId, organizationId))).toEqual({
			refused: 'INVITATION_NOT_FOUND',
			statusCode: 404,
		});
		expect((await invitationRow(invitationId))!.status).toBe('pending');
	});
});

describe('inviting an address again', () => {
	it('replaces the earlier Invitation, recorded as cancelled by the newer', async () => {
		const { invitationId: earlier } = await invite(OWNER, { role: 'member' });

		const { invitationId: later } = await invite(OWNER, { role: 'admin' });

		expect((await invitationRow(earlier))!.status).toBe('canceled');
		expect((await pending(OWNER)).map(({ id }) => id)).toEqual([later]);
		expect(await audited('invitation.cancelled')).toEqual([
			expect.objectContaining({
				actorUserId: await userIdOf(OWNER),
				detail: { invitationId: earlier, email: INVITEE, replacedBy: later, as: 'owner' },
			}),
		]);
	});

	it('that fails before the new one is recorded leaves the earlier standing, alone', async () => {
		const { invitationId: earlier } = await invite(OWNER, { role: 'member' });
		await accounts.failInsertsInto('auditRecord');

		await expect(invite(OWNER, { role: 'admin' })).rejects.toThrow(/injected failure/);

		expect((await pending(OWNER)).map(({ id }) => id)).toEqual([earlier]);
		expect(await invitations()).toBe(1);
	});

	// The library's own path, which only the server reaches, records a replacement
	// as a cancellation with none recorded: so every cancellation here is recorded.
	it('then through the library records each replacement once', async () => {
		await invite(OWNER);
		await invite(OWNER);

		await accounts.auth.api.createInvitation({
			body: { email: INVITEE, role: 'member', organizationId: keepr.id },
			headers: new Headers({ cookie: await accounts.signIn(OWNER) }),
		});

		expect(await audited('invitation.cancelled')).toHaveLength(2);
	});
});

describe('inviting needs a recent sign-in', () => {
	it.each([
		['as old as the limit', RECENT_SIGN_IN_MS, null],
		['older than the limit', RECENT_SIGN_IN_MS + 1, 'RECENT_SIGN_IN_REQUIRED'],
	])('a sign-in %s is refused: %s', async (_case, age, refused) => {
		const now = Date.now();
		vi.useFakeTimers({ toFake: ['Date'], now });
		const actor = await actorFor(OWNER);
		vi.setSystemTime(now + age);

		const answered = await outcome(
			inviteMember(
				database,
				actor,
				{ organizationId: keepr.id, email: INVITEE, role: 'member' },
				{ email: accounts.email, origin: ORIGIN },
			),
		);

		expect((answered as { refused?: string }).refused ?? null).toBe(refused);
		expect(await invitations()).toBe(refused === null ? 1 : 0);
	});
});

describe('an admin inviting an address again', () => {
	it.each<[string, OrganisationRole, string | null, string]>([
		['an owner’s offer to be a member', 'member', null, 'canceled'],
		['an owner’s offer to be an owner', 'owner', 'OWNER_REQUIRED', 'pending'],
	])('replacing %s is refused: %s', async (_case, offered, refused, earlierStatus) => {
		const { invitationId: earlier } = await invite(OWNER, { role: offered });

		const answered = await outcome(invite(await holding('admin'), { role: 'admin' }));

		expect((answered as { refused?: string }).refused ?? null).toBe(refused);
		expect(await invitationRow(earlier)).toMatchObject({ status: earlierStatus, role: offered });
	});
});

/** An Invitation `inviterId` made to the Keepr Organisation at `at`, written as the library writes one. */
function madeAt(inviterId: string, at: number, n: number) {
	return {
		id: `made-${at}-${n}`,
		organizationId: keepr.id,
		email: `earlier-${n}@example.com`,
		role: 'member',
		status: 'canceled',
		expiresAt: new Date(at + 7 * DAY_MS),
		createdAt: new Date(at),
		inviterId,
	};
}

describe('how many Invitations one inviter makes', () => {
	it.each([
		[
			'one under the cap',
			INVITATIONS_PER_INVITER_PER_HOUR - 1,
			{ invitationId: expect.any(String) },
		],
		[
			'at the cap',
			INVITATIONS_PER_INVITER_PER_HOUR,
			{ refused: 'TOO_MANY_INVITATIONS', statusCode: 429 },
		],
	])('in the last hour, %s, answers %o', async (_case, made, answer) => {
		const now = Date.now();
		const inviterId = await userIdOf(OWNER);
		// Made more than an hour ago, so not counted.
		await database.insert(schema.invitation).values(madeAt(inviterId, now - 61 * 60 * 1000, 0));
		await database
			.insert(schema.invitation)
			.values(Array.from({ length: made }, (_, n) => madeAt(inviterId, now - 30 * 60 * 1000, n)));

		const answered = await outcome(invite(OWNER));

		expect(answered).toEqual(answer);
	});

	it('is counted per inviter, so another manager still invites', async () => {
		const inviterId = await userIdOf(OWNER);
		await database
			.insert(schema.invitation)
			.values(
				Array.from({ length: INVITATIONS_PER_INVITER_PER_HOUR }, (_, n) =>
					madeAt(inviterId, Date.now(), n),
				),
			);

		expect(await outcome(invite(await holding('admin')))).toEqual({
			invitationId: expect.any(String),
		});
	});
});

describe('an address invited', () => {
	it('is kept lower-cased, as one plausible mailbox', async () => {
		const { invitationId } = await invite(OWNER, {
			email: ' First.Last+club@Mail.Example.co.uk ',
		});

		expect((await pending(OWNER)).find(({ id }) => id === invitationId)?.email).toBe(
			'first.last+club@mail.example.co.uk',
		);
	});
});

describe('a stored Invitation whose App roles cannot be read', () => {
	it('is listed offering none, and the others as they are', async () => {
		const { invitationId } = await invite(OWNER, { appRoles: { stream: 'member' } });
		await database.insert(schema.invitation).values({
			...madeAt(await userIdOf(OWNER), Date.now(), 0),
			id: 'unreadable',
			status: 'pending',
			appRoles: '{not json',
		});

		expect(
			Object.fromEntries((await pending(OWNER)).map(({ id, appRoles }) => [id, appRoles])),
		).toEqual({ unreadable: {}, [invitationId]: { stream: 'member' } });
	});
});
