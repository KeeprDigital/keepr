import type { OrganisationRole, TestAccounts } from '~~/test/helpers/keeprAccounts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pendingInvitations } from '~~/server/utils/pendingInvitations';
import { createTestAccounts, fakeBreachedPasswordService } from '~~/test/helpers/keeprAccounts';

// An owner or admin invites an email address to their Organisation with an
// Organisation role and an App role per App, request in and response out.

const OWNER = 'owner@keepr.digital';
const INVITEE = 'newcomer@example.com';
const DAY_MS = 24 * 60 * 60 * 1000;

let accounts: TestAccounts;
let keepr: { id: string };

beforeEach(async () => {
	fakeBreachedPasswordService();
	accounts = await createTestAccounts();
	await accounts.createUser(OWNER);
	keepr = await accounts.createOrganisation('Keepr', OWNER);
});

afterEach(async () => {
	vi.useRealTimers();
	await accounts.harness.close();
});

async function invite(
	cookie: string,
	body: { email?: string; role?: OrganisationRole; appRoles?: string },
) {
	return await accounts.send('/organization/invite-member', {
		body: { email: INVITEE, role: 'member', organizationId: keepr.id, ...body },
		headers: { cookie },
	});
}

async function invitationRow(id: string) {
	const ctx = await accounts.auth.$context;
	return await ctx.adapter.findOne<{
		role: string;
		status: string;
		appRoles: string | null;
		expiresAt: Date;
	}>({
		model: 'invitation',
		where: [{ field: 'id', value: id }],
	});
}

describe('an Invitation', () => {
	it('carries the Organisation role and the App roles, and lasts seven days', async () => {
		vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-17T10:00:00Z') });
		const cookie = await accounts.signIn(OWNER);

		const response = await invite(cookie, {
			role: 'admin',
			appRoles: JSON.stringify({ stream: 'admin', score: 'member' }),
		});

		expect(response.status).toBe(200);
		const { id } = (await response.json()) as { id: string };
		const row = await invitationRow(id);
		expect(row).toMatchObject({ role: 'admin' });
		expect(JSON.parse(row!.appRoles!)).toEqual({ stream: 'admin', score: 'member' });
		expect(row!.expiresAt.getTime()).toBe(Date.parse('2026-11-17T10:00:00Z') + 7 * DAY_MS);
	});

	it('is emailed to the invitee, naming who invited them, to what, and the link', async () => {
		const cookie = await accounts.signIn(OWNER);

		const { id } = (await (await invite(cookie, {})).json()) as { id: string };
		await accounts.afterResponses();

		expect(accounts.email.sent).toHaveLength(1);
		const [sent] = accounts.email.sent;
		expect(sent!.to).toBe(INVITEE);
		expect(sent!.subject).toContain('Keepr');
		expect(sent!.text).toContain('owner');
		expect(sent!.text).toContain(`http://localhost:3000/invitation#id=${id}`);
	});

	it('is created, its link answered, when sending the email fails', async () => {
		const failing = await createTestAccounts({
			harness: accounts.harness,
			email: { send: async () => await Promise.reject(new Error('the email service is down')) },
		});
		const cookie = await failing.signIn(OWNER);

		const response = await failing.send('/organization/invite-member', {
			body: { email: INVITEE, role: 'member', organizationId: keepr.id },
			headers: { cookie },
		});
		await failing.afterResponses();

		expect(response.status).toBe(200);
		const { id } = (await response.json()) as { id: string };
		expect(await invitationRow(id)).toBeDefined();
	});

	it('is in the Audit Record, with who invited whom and with what', async () => {
		const cookie = await accounts.signIn(OWNER);
		const owner = (await (await accounts.auth.$context).internalAdapter.findUserByEmail(OWNER))!;

		const { id } = (await (
			await invite(cookie, { appRoles: JSON.stringify({ stream: 'member' }) })
		).json()) as { id: string };

		const created = (await accounts.auditRecord()).filter(
			(row) => row.action === 'invitation.created',
		);
		expect(created).toEqual([
			expect.objectContaining({
				actorUserId: owner.user.id,
				organizationId: keepr.id,
				at: expect.any(Date),
			}),
		]);
		expect(JSON.parse(created[0]!.detail!)).toEqual({
			invitationId: id,
			email: INVITEE,
			role: 'member',
			appRoles: { stream: 'member' },
		});
	});
});

describe('the App roles offered', () => {
	it.each([
		['an App the registry does not name', JSON.stringify({ chess: 'member' })],
		['a role the App does not define', JSON.stringify({ stream: 'owner' })],
		['anything but an App-to-role map', JSON.stringify(['stream'])],
		['not JSON at all', 'stream'],
	])('refuse %s', async (_case, appRoles) => {
		const cookie = await accounts.signIn(OWNER);

		const response = await invite(cookie, { appRoles });

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ code: 'APP_ROLE_NOT_IN_REGISTRY' });
		const ctx = await accounts.auth.$context;
		expect(await ctx.adapter.count({ model: 'invitation' })).toBe(0);
	});
});

describe('who may invite', () => {
	it.each<[OrganisationRole, OrganisationRole, number]>([
		['owner', 'owner', 200],
		['admin', 'owner', 403],
		['admin', 'admin', 200],
		['member', 'member', 403],
	])('an %s inviting an %s answers %i', async (inviterRole, role, status) => {
		const inviter = `${inviterRole}-inviter@keepr.digital`;
		const { id } = await accounts.createUser(inviter);
		await accounts.addMember(id, 'keepr', { role: inviterRole });

		const response = await invite(await accounts.signIn(inviter), { role });

		expect(response.status).toBe(status);
	});
});

describe('the limits on an Organisation', () => {
	it('admit far more pending Invitations than the library’s hundred', async () => {
		const cookie = await accounts.signIn(OWNER);
		// Server-side, as the rate limiter counts only requests.
		for (let n = 0; n < 100; n++)
			await accounts.auth.api.createInvitation({
				body: { email: `invitee-${n}@example.com`, role: 'member', organizationId: keepr.id },
				headers: { cookie },
			});

		expect((await invite(cookie, { email: 'invitee-100@example.com' })).status).toBe(200);
	});
});

async function cookieOf(role: OrganisationRole) {
	if (role === 'owner') return await accounts.signIn(OWNER);
	const email = `${role}@keepr.digital`;
	const { id } = await accounts.createUser(email);
	await accounts.addMember(id, 'keepr', { role });
	return await accounts.signIn(email);
}

async function invitationIdOf(response: Response) {
	return ((await response.json()) as { id: string }).id;
}

async function cancel(cookie: string, invitationId: string) {
	return await accounts.send('/organization/cancel-invitation', {
		body: { invitationId },
		headers: { cookie },
	});
}

async function pending(cookie: string) {
	return await pendingInvitations(accounts.auth, new Headers({ cookie }));
}

async function ownerId() {
	return (await (await accounts.auth.$context).internalAdapter.findUserByEmail(OWNER))!.user.id;
}

async function cancellations() {
	return (await accounts.auditRecord()).filter((row) => row.action === 'invitation.cancelled');
}

describe('the pending Invitations', () => {
	it('are listed with who and what each offers, and none that has closed', async () => {
		vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-17T10:00:00Z') });
		await invite(await accounts.signIn(OWNER), { email: 'lapsed@example.com' });
		vi.setSystemTime(new Date('2026-11-25T10:00:00Z'));
		const cookie = await accounts.signIn(OWNER);
		await cancel(cookie, await invitationIdOf(await invite(cookie, { email: 'gone@example.com' })));
		const id = await invitationIdOf(
			await invite(cookie, { role: 'admin', appRoles: JSON.stringify({ stream: 'member' }) }),
		);

		expect(await pending(cookie)).toEqual([
			{
				id,
				email: INVITEE,
				role: 'admin',
				appRoles: { stream: 'member' },
				inviterName: 'owner',
				expiresAt: '2026-12-02T10:00:00.000Z',
			},
		]);
	});

	it('are listed to an admin, but not an owner’s offer to an owner', async () => {
		const cookie = await cookieOf('admin');
		const owners = await accounts.signIn(OWNER);
		await invite(owners, { email: 'next-owner@example.com', role: 'owner' });
		await invite(owners, {});

		expect((await pending(cookie)).map(({ email }) => email)).toEqual([INVITEE]);
	});

	it('are refused to a member', async () => {
		const cookie = await cookieOf('member');

		await expect(pending(cookie)).rejects.toMatchObject({ statusCode: 403 });
	});
});

describe('cancelling an Invitation', () => {
	it.each<[OrganisationRole, number]>([
		['admin', 200],
		['member', 403],
	])('by an %s answers %i', async (role, status) => {
		const cookie = await cookieOf(role);
		const id = await invitationIdOf(await invite(await accounts.signIn(OWNER), {}));

		const response = await cancel(cookie, id);

		expect(response.status).toBe(status);
		expect((await invitationRow(id))!.status).toBe(status === 200 ? 'canceled' : 'pending');
	});

	it('is in the Audit Record, with who cancelled which', async () => {
		const cookie = await accounts.signIn(OWNER);
		const id = await invitationIdOf(await invite(cookie, {}));

		await cancel(cookie, id);

		const cancelled = await cancellations();
		expect(cancelled).toEqual([
			expect.objectContaining({ actorUserId: await ownerId(), organizationId: keepr.id }),
		]);
		expect(JSON.parse(cancelled[0]!.detail!)).toEqual({ invitationId: id, email: INVITEE });
	});

	it('is refused once it has been accepted, leaving it accepted', async () => {
		const cookie = await accounts.signIn(OWNER);
		await accounts.createUser(INVITEE);
		const id = await invitationIdOf(await invite(cookie, {}));
		await accounts.send('/organization/accept-invitation', {
			body: { invitationId: id },
			headers: { cookie: await accounts.signIn(INVITEE) },
		});

		const response = await cancel(cookie, id);

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ code: 'INVITATION_NOT_PENDING' });
		expect((await invitationRow(id))!.status).toBe('accepted');
		expect(await cancellations()).toEqual([]);
	});
});

describe('inviting an address again', () => {
	it('replaces the earlier Invitation, recorded as cancelled by the newer', async () => {
		const cookie = await accounts.signIn(OWNER);
		const earlier = await invitationIdOf(await invite(cookie, { role: 'member' }));

		const later = await invitationIdOf(await invite(cookie, { role: 'admin' }));

		expect((await invitationRow(earlier))!.status).toBe('canceled');
		expect((await pending(cookie)).map(({ id }) => id)).toEqual([later]);
		const cancelled = await cancellations();
		expect(cancelled).toEqual([expect.objectContaining({ actorUserId: await ownerId() })]);
		expect(JSON.parse(cancelled[0]!.detail!)).toEqual({
			invitationId: earlier,
			email: INVITEE,
			replacedBy: later,
		});
	});
});
