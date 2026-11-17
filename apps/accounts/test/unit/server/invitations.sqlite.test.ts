import type { OrganisationRole, TestAccounts } from '~~/test/helpers/keeprAccounts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
	return await ctx.adapter.findOne<{ role: string; appRoles: string | null; expiresAt: Date }>({
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
