import type { IdentityDatabase } from '~~/server/db';
import type { Actor } from '~~/server/utils/actor';
import type { KeeprRefusal } from '~~/server/utils/refusal';
import type { OrganisationRole, TestAccounts } from '~~/test/helpers/keeprAccounts';
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { identityDatabase, schema } from '~~/server/db';
import { requestActor } from '~~/server/utils/actor';
import { inviteMember } from '~~/server/utils/invitations';
import {
	changeOrganisationRole,
	listMembers,
	removeAppAccess,
	removeMember,
	setAppAccess,
} from '~~/server/utils/memberManagement';
import { createTestAccounts, fakeBreachedPasswordService } from '~~/test/helpers/keeprAccounts';

// An Organisation's owners and admins manage its members and their App access,
// request in and outcome out: the rows stored and the Audit Record.

const OWNER = 'owner@keepr.digital';
const MEMBER = 'member@keepr.digital';

let accounts: TestAccounts;
let database: IdentityDatabase;
let keepr: { id: string };
let member: { userId: string; memberId: string };

beforeEach(async () => {
	fakeBreachedPasswordService();
	accounts = await createTestAccounts();
	database = identityDatabase(accounts.harness.database);
	await accounts.createUser(OWNER);
	keepr = await accounts.createOrganisation('Keepr', OWNER);
	const { id } = await accounts.createUser(MEMBER);
	member = {
		userId: id,
		memberId: (await accounts.addMember(id, 'keepr', { role: 'member', apps: { stream: 'admin' } }))
			.memberId,
	};
});

afterEach(async () => {
	vi.useRealTimers();
	await accounts.harness.close();
});

/** The Actor a browser signed in as `email` is, sending `method` from Keepr Accounts' own page. */
async function actorFor(email: string, method = 'GET') {
	const cookie = await accounts.signIn(email);
	return await requestActor(
		accounts.auth,
		new Request('http://localhost:3000/api/organisations', {
			method,
			headers: { cookie, 'sec-fetch-site': 'same-origin' },
		}),
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

/** The code an `outcome` was refused with, or `null` when it was not. */
function refusedWith(answered: unknown): string | null {
	return (answered as { refused?: string } | undefined)?.refused ?? null;
}

/** A User of their own, holding `role` in the Keepr Organisation. */
async function memberWithRole(role: OrganisationRole) {
	const email = `${role}-${crypto.randomUUID()}@keepr.digital`;
	const { id } = await accounts.createUser(email);
	const { memberId } = await accounts.addMember(id, 'keepr', { role });
	return { email, memberId };
}

/** A Keepr Administrator who is no member of the Keepr Organisation. */
async function keeprAdministrator() {
	const email = `administrator-${crypto.randomUUID()}@keepr.digital`;
	await accounts.createUser(email, { role: 'admin' });
	return email;
}

describe('the members an owner lists', () => {
	it('are each named, with their Organisation role and App roles', async () => {
		const listed = await listMembers(database, await actorFor(OWNER), keepr.id);

		expect(listed.organisation).toEqual({ id: keepr.id, name: 'Keepr' });
		expect(listed.members).toEqual([
			expect.objectContaining({ email: OWNER, role: 'owner', apps: {} }),
			expect.objectContaining({
				memberId: member.memberId,
				userId: member.userId,
				name: 'member',
				email: MEMBER,
				role: 'member',
				apps: { stream: 'admin' },
			}),
		]);
	});
});

describe('who may manage an Organisation’s members', () => {
	it.each<[string, string | null, () => Promise<string>]>([
		['an owner', 'owner', async () => OWNER],
		['an admin', 'admin', async () => (await memberWithRole('admin')).email],
		['a member', null, async () => MEMBER],
		[
			'a User of another Organisation',
			null,
			async () => {
				const { id } = await accounts.createUser('outsider@example.com');
				await accounts.addMember(id, 'elsewhere', { role: 'owner' });
				return 'outsider@example.com';
			},
		],
		// Story 48: one who is no member at all manages as an owner would.
		['a Keepr Administrator', 'keepr-administrator', keeprAdministrator],
	])('%s manages as %s', async (_who, standing, user) => {
		const listing = await outcome(listMembers(database, await actorFor(await user()), keepr.id));

		expect(listing).toMatchObject(
			standing === null ? { refused: 'NOT_A_MANAGER', statusCode: 403 } : { standing },
		);
	});
});

/** What the member screen lists for the member `memberId`, read as an owner. */
async function listed(memberId: string) {
	const { members } = await listMembers(database, await actorFor(OWNER), keepr.id);
	return members.find((listedMember) => listedMember.memberId === memberId);
}

/** The Audit Record's rows for `action`, their detail read. */
async function audited(action: string) {
	return (await accounts.auditRecord())
		.filter((row) => row.action === action)
		.map((row) => ({ ...row, detail: row.detail === null ? null : JSON.parse(row.detail) }));
}

describe('a member’s App access', () => {
	it.each([
		['changes their role in an App', 'stream', 'member', { stream: 'member' }],
		['gives them a role in another App', 'score', 'admin', { stream: 'admin', score: 'admin' }],
	])('%s', async (_case, app, role, apps) => {
		await setAppAccess(database, await actorFor(OWNER, 'PUT'), {
			organizationId: keepr.id,
			memberId: member.memberId,
			app,
			role,
		});

		expect(await listed(member.memberId)).toMatchObject({ role: 'member', apps });
	});

	it('is removed in one App while they stay a member', async () => {
		await setAppAccess(database, await actorFor(OWNER, 'PUT'), {
			organizationId: keepr.id,
			memberId: member.memberId,
			app: 'score',
			role: 'member',
		});

		await removeAppAccess(database, await actorFor(OWNER, 'DELETE'), {
			organizationId: keepr.id,
			memberId: member.memberId,
			app: 'stream',
		});

		expect(await listed(member.memberId)).toMatchObject({
			role: 'member',
			apps: { score: 'member' },
		});
	});

	it.each([
		['an App the registry does not name', 'chess', 'member'],
		['a role the App does not define', 'stream', 'owner'],
	])('refuses %s, and keeps what they had', async (_case, app, role) => {
		const setting = setAppAccess(database, await actorFor(OWNER, 'PUT'), {
			organizationId: keepr.id,
			memberId: member.memberId,
			app,
			role,
		});

		await expect(setting).rejects.toMatchObject({
			statusCode: 400,
			code: 'APP_ROLE_NOT_IN_REGISTRY',
		});
		expect(await listed(member.memberId)).toMatchObject({ apps: { stream: 'admin' } });
	});

	it('is in the Audit Record, set and removed, with who, when, where and whom', async () => {
		const owner = await actorFor(OWNER, 'PUT');
		await setAppAccess(database, owner, {
			organizationId: keepr.id,
			memberId: member.memberId,
			app: 'stream',
			role: 'member',
		});
		await removeAppAccess(database, owner, {
			organizationId: keepr.id,
			memberId: member.memberId,
			app: 'stream',
		});

		const who = {
			actorUserId: owner.userId,
			organizationId: keepr.id,
			subjectUserId: member.userId,
			at: expect.any(Date),
		};
		expect(await audited('app-access.set')).toEqual([
			expect.objectContaining({
				...who,
				detail: {
					memberId: member.memberId,
					app: 'stream',
					role: 'member',
					was: 'admin',
					as: 'owner',
				},
			}),
		]);
		expect(await audited('app-access.removed')).toEqual([
			expect.objectContaining({
				...who,
				detail: { memberId: member.memberId, app: 'stream', was: 'member', as: 'owner' },
			}),
		]);
	});
});

/** The Keepr Organisation's first owner, as a member. */
async function owner() {
	const { members } = await listMembers(database, await actorFor(OWNER), keepr.id);
	return members.find(({ email }) => email === OWNER)!;
}

describe('a member’s Organisation role', () => {
	it.each<[string, string, string | null, () => Promise<string>]>([
		['an owner', 'admin', null, async () => OWNER],
		['an owner', 'owner', null, async () => OWNER],
		['a Keepr Administrator', 'admin', null, keeprAdministrator],
		['an admin', 'admin', 'OWNER_REQUIRED', async () => (await memberWithRole('admin')).email],
		['an owner', 'superuser', 'ORGANISATION_ROLE_NOT_KNOWN', async () => OWNER],
	])('changed by %s to %s: refused %s', async (_who, role, refusal, actor) => {
		const changing = await outcome(
			changeOrganisationRole(database, await actorFor(await actor(), 'PUT'), {
				organizationId: keepr.id,
				memberId: member.memberId,
				role,
			}),
		);

		expect(refusedWith(changing)).toBe(refusal);
		expect(await listed(member.memberId)).toMatchObject({
			role: refusal === null ? role : 'member',
		});
	});

	it.each<[string, string | null, OrganisationRole[]]>([
		['the last owner', 'LAST_OWNER', []],
		['one of two owners', null, ['owner']],
		['the last owner, beside an admin', 'LAST_OWNER', ['admin']],
	])('of %s, demoted, is refused %s', async (_case, refusal, others) => {
		for (const role of others) await memberWithRole(role);
		const { memberId } = await owner();

		const demoting = await outcome(
			changeOrganisationRole(database, await actorFor(OWNER, 'PUT'), {
				organizationId: keepr.id,
				memberId,
				role: 'admin',
			}),
		);

		expect(demoting).toEqual(refusal === null ? undefined : { refused: refusal, statusCode: 409 });
		expect(await listed(memberId)).toMatchObject({
			role: refusal === null ? 'admin' : 'owner',
		});
	});

	it('is in the Audit Record, with who, when, where, whom and from what', async () => {
		const actor = await actorFor(OWNER, 'PUT');

		await changeOrganisationRole(database, actor, {
			organizationId: keepr.id,
			memberId: member.memberId,
			role: 'admin',
		});

		expect(await audited('member.role-changed')).toEqual([
			expect.objectContaining({
				actorUserId: actor.userId,
				organizationId: keepr.id,
				subjectUserId: member.userId,
				at: expect.any(Date),
				detail: { memberId: member.memberId, role: 'admin', was: 'member', as: 'owner' },
			}),
		]);
	});
});

describe('removing a member', () => {
	it('takes them out of the Organisation, App access and all, and is in the Audit Record', async () => {
		const actor = await actorFor(OWNER, 'DELETE');

		await removeMember(database, actor, { organizationId: keepr.id, memberId: member.memberId });

		expect(await listed(member.memberId)).toBeUndefined();
		expect(await audited('member.removed')).toEqual([
			expect.objectContaining({
				actorUserId: actor.userId,
				organizationId: keepr.id,
				subjectUserId: member.userId,
				at: expect.any(Date),
				detail: {
					memberId: member.memberId,
					role: 'member',
					apps: { stream: 'admin' },
					as: 'owner',
				},
			}),
		]);
	});

	const anAdmin = async () => (await memberWithRole('admin')).email;
	const anotherOwner = async () => (await memberWithRole('owner')).memberId;
	const theFirstOwner = async () => (await owner()).memberId;

	it.each<[string, string | null, () => Promise<string>, () => Promise<string>]>([
		['an admin removes a member', null, anAdmin, async () => member.memberId],
		['an admin removes an owner', 'OWNER_REQUIRED', anAdmin, anotherOwner],
		['an owner removes another owner', null, async () => OWNER, anotherOwner],
		['the last owner removes themselves', 'LAST_OWNER', async () => OWNER, theFirstOwner],
		[
			'a Keepr Administrator removes the last owner',
			'LAST_OWNER',
			keeprAdministrator,
			theFirstOwner,
		],
		[
			'a member removes a member',
			'NOT_A_MANAGER',
			async () => MEMBER,
			async () => (await memberWithRole('member')).memberId,
		],
	])('when %s: refused %s', async (_case, refusal, actor, target) => {
		const memberId = await target();

		const removing = await outcome(
			removeMember(database, await actorFor(await actor(), 'DELETE'), {
				organizationId: keepr.id,
				memberId,
			}),
		);

		expect(refusedWith(removing)).toBe(refusal);
		expect((await listed(memberId)) !== undefined).toBe(refusal !== null);
	});

	it('cancels the Invitations they offered there that are still open, each in the Audit Record', async () => {
		const admin = await memberWithRole('admin');
		const adminActor = await actorFor(admin.email, 'POST');
		const { organizationId: elsewhere } = await accounts.addMember(adminActor.userId, 'elsewhere', {
			role: 'owner',
		});
		const offered = await invitationBy(adminActor, keepr.id, 'by-the-admin@example.com');
		const theirsElsewhere = await invitationBy(adminActor, elsewhere, 'elsewhere@example.com');
		const theOwners = await invitationBy(
			await actorFor(OWNER, 'POST'),
			keepr.id,
			'by-the-owner@example.com',
		);
		const actor = await actorFor(OWNER, 'DELETE');

		await removeMember(database, actor, { organizationId: keepr.id, memberId: admin.memberId });

		expect(await statusOf(offered, theirsElsewhere, theOwners)).toEqual([
			'canceled',
			'pending',
			'pending',
		]);
		expect(await audited('invitation.cancelled')).toEqual([
			expect.objectContaining({
				actorUserId: actor.userId,
				organizationId: keepr.id,
				detail: {
					invitationId: offered,
					email: 'by-the-admin@example.com',
					as: 'owner',
					because: 'inviter-removed',
				},
			}),
		]);
	});
});

/** An Invitation `actor` makes to `organizationId`, for `email`: its id. */
async function invitationBy(actor: Actor, organizationId: string, email: string) {
	const { invitationId } = await inviteMember(
		database,
		actor,
		{ organizationId, email, role: 'member' },
		{ email: accounts.email, origin: 'http://localhost:3000' },
	);
	return invitationId;
}

async function statusOf(...invitationIds: string[]) {
	const rows = await database
		.select({ id: schema.invitation.id, status: schema.invitation.status })
		.from(schema.invitation)
		.where(inArray(schema.invitation.id, invitationIds));
	return invitationIds.map((id) => rows.find((row) => row.id === id)?.status);
}

// A member is changed only through the Organisation they belong to: one named
// under another Organisation is none, even to one who manages both.
describe('a member of another Organisation, named under this one', () => {
	it.each<[string, (actor: Actor, memberId: string) => Promise<unknown>]>([
		[
			'setting App access',
			async (actor, memberId) =>
				await setAppAccess(database, actor, {
					organizationId: keepr.id,
					memberId,
					app: 'score',
					role: 'member',
				}),
		],
		[
			'removing App access',
			async (actor, memberId) =>
				await removeAppAccess(database, actor, {
					organizationId: keepr.id,
					memberId,
					app: 'stream',
				}),
		],
		[
			'changing an Organisation role',
			async (actor, memberId) =>
				await changeOrganisationRole(database, actor, {
					organizationId: keepr.id,
					memberId,
					role: 'owner',
				}),
		],
		[
			'removing a member',
			async (actor, memberId) =>
				await removeMember(database, actor, { organizationId: keepr.id, memberId }),
		],
	])('is refused for %s, changing nothing', async (_case, changing) => {
		const { id } = await accounts.createUser('elsewhere@example.com');
		const { memberId } = await accounts.addMember(id, 'elsewhere', {
			role: 'member',
			apps: { stream: 'admin' },
		});
		const actor = await actorFor(OWNER, 'PUT');
		await accounts.addMember(actor.userId, 'elsewhere', { role: 'owner' });

		await expect(changing(actor, memberId)).rejects.toMatchObject({
			statusCode: 404,
			code: 'MEMBER_NOT_FOUND',
		});
		const [held] = await database
			.select({ role: schema.member.role })
			.from(schema.member)
			.where(eq(schema.member.id, memberId));
		expect(held).toEqual({ role: 'member' });
		expect(
			await database
				.select({ app: schema.appAccess.app, role: schema.appAccess.role })
				.from(schema.appAccess)
				.where(eq(schema.appAccess.memberId, memberId)),
		).toEqual([{ app: 'stream', role: 'admin' }]);
	});
});

// Each change asks for a recent sign-in (`requireRecentSignIn`); listing does not.
describe('a change made eleven minutes after signing in', () => {
	const change = { organizationId: '', memberId: '' };
	it.each<[string, (actor: Actor) => Promise<unknown>]>([
		[
			'setting App access',
			async (actor) =>
				await setAppAccess(database, actor, { ...change, app: 'score', role: 'member' }),
		],
		[
			'removing App access',
			async (actor) => await removeAppAccess(database, actor, { ...change, app: 'stream' }),
		],
		[
			'changing an Organisation role',
			async (actor) => await changeOrganisationRole(database, actor, { ...change, role: 'admin' }),
		],
		['removing a member', async (actor) => await removeMember(database, actor, change)],
	])('%s is asked to sign in again, and changes nothing', async (_case, changing) => {
		Object.assign(change, { organizationId: keepr.id, memberId: member.memberId });
		vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-17T10:00:00Z') });
		const actor = await actorFor(OWNER, 'PUT');
		vi.setSystemTime(new Date('2026-11-17T10:11:00Z'));

		await expect(changing(actor)).rejects.toMatchObject({
			statusCode: 403,
			code: 'RECENT_SIGN_IN_REQUIRED',
		});
		expect(await listed(member.memberId)).toMatchObject({
			role: 'member',
			apps: { stream: 'admin' },
		});
		expect(await listMembers(database, actor, keepr.id)).toBeDefined();
	});
});
