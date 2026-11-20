import type { TestAccounts } from '~~/test/helpers/keeprAccounts';
import { admin } from 'better-auth/plugins';
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
	});

	it('are asked by a Session the library itself admits as an administrator', async () => {
		const response = await accounts.send('/get-session', {
			headers: { cookie: administratorCookie },
		});

		expect(await response.json()).toMatchObject({ user: { role: 'admin' } });
	});

	it.each(adminRoutes)('%s %s answers 404', async (method, path) => {
		const response = await accounts.send(path, {
			method,
			headers: { cookie: administratorCookie },
			...(method === 'GET' ? {} : { body: {} }),
		});

		expect(response.status).toBe(404);
	});
});

// Nothing renames or deletes an Organisation; the library's routes would, unaudited.
// One is created only through Keepr Accounts' own route, by a Keepr Administrator.
describe('the library’s Organisation routes', () => {
	it.each([
		['an ordinary User', 'walk-in@keepr.digital'],
		['a Keepr Administrator', 'administrator@keepr.digital'],
	])('/organization/create is refused to %s', async (_who, email) => {
		if (email !== 'administrator@keepr.digital') await accounts.createUser(email);

		const response = await accounts.send('/organization/create', {
			body: { name: 'Self Made', slug: `self-made-${email.length}` },
			headers: { cookie: await accounts.signIn(email) },
		});

		expect(response.status).toBe(403);
	});

	it.each([
		['/organization/update', 'renamed', { data: { name: 'Renamed' } }],
		['/organization/delete', 'deleted', {}],
	])('%s answers 404 to the Organisation’s owner', async (path, slug, body) => {
		const organisation = await accounts.createOrganisation(slug, 'administrator@keepr.digital');

		const response = await accounts.send(path, {
			body: { organizationId: organisation.id, ...body },
			headers: { cookie: administratorCookie },
		});

		expect(response.status).toBe(404);
	});
});

// Keepr Accounts' own member and Invitation routes admit a Keepr Administrator to
// any Organisation, ask for a recent sign-in where a change needs one, and keep
// App access with the member; the library's would do none of it.
describe('the library’s member and Invitation routes', () => {
	it.each([
		['POST', '/organization/update-member-role', 'roles'],
		['POST', '/organization/remove-member', 'removals'],
		['POST', '/organization/invite-member', 'invites'],
		['GET', '/organization/list-invitations', 'invitation-lists'],
		['POST', '/organization/cancel-invitation', 'cancellations'],
	])('%s %s answers 404 to the Organisation’s owner', async (method, path, slug) => {
		const organisation = await accounts.createOrganisation(slug, 'administrator@keepr.digital');
		const { id } = await accounts.createUser(`member-of-${slug}@keepr.digital`);
		const { memberId } = await accounts.addMember(id, slug);
		const body = {
			organizationId: organisation.id,
			memberId,
			memberIdOrEmail: memberId,
			email: 'invitee@example.com',
			invitationId: 'any',
			role: 'admin',
		};

		const response = await accounts.send(
			method === 'GET' ? `${path}?organizationId=${organisation.id}` : path,
			{ method, headers: { cookie: administratorCookie }, ...(method === 'GET' ? {} : { body }) },
		);

		expect(response.status).toBe(404);
	});
});

// A member without administrative rights sees nobody else's access, and leaves
// only by being removed, which is audited and keeps the last owner.
describe('the library’s membership reads and leaving', () => {
	let members: TestAccounts;
	let organizationId: string;
	let memberCookie: string;

	beforeAll(async () => {
		members = await createTestAccounts();
		await members.createUser('owner@keepr.digital');
		organizationId = (await members.createOrganisation('reads', 'owner@keepr.digital')).id;
		const { id } = await members.createUser('member@keepr.digital');
		await members.addMember(id, 'reads');
		memberCookie = await members.signIn('member@keepr.digital');
	});

	afterAll(async () => await members.harness.close());

	it.each([
		['GET', '/organization/list-members'],
		['GET', '/organization/get-full-organization'],
		['POST', '/organization/leave'],
	])('%s %s answers 404 to a member', async (method, path) => {
		const response = await members.send(
			method === 'GET' ? `${path}?organizationId=${organizationId}` : path,
			{
				method,
				headers: { cookie: memberCookie },
				...(method === 'GET' ? {} : { body: { organizationId } }),
			},
		);

		expect(response.status).toBe(404);
	});
});

// An Invitation is read, accepted or declined only with the secret its emailed
// link carries (ADR-0155): the library's routes would take its id alone.
describe('the library’s routes that answer an Invitation by its id', () => {
	let invitations: TestAccounts;
	let invitationId: string;
	let inviteeCookie: string;

	beforeAll(async () => {
		invitations = await createTestAccounts();
		await invitations.createUser('owner@keepr.digital');
		const { id: organizationId } = await invitations.createOrganisation(
			'invitations',
			'owner@keepr.digital',
		);
		await invitations.createUser('invitee@keepr.digital');
		({ id: invitationId } = await invitations.auth.api.createInvitation({
			body: { email: 'invitee@keepr.digital', role: 'member', organizationId },
			headers: new Headers({ cookie: await invitations.signIn('owner@keepr.digital') }),
		}));
		inviteeCookie = await invitations.signIn('invitee@keepr.digital');
	});

	afterAll(async () => await invitations.harness.close());

	it.each([
		['GET', '/organization/get-invitation'],
		['GET', '/organization/list-user-invitations'],
		['POST', '/organization/accept-invitation'],
		['POST', '/organization/reject-invitation'],
	])('%s %s answers 404 to the invitee, leaving it open', async (method, path) => {
		const response = await invitations.send(
			method === 'GET' ? `${path}?id=${invitationId}` : path,
			{
				method,
				headers: { cookie: inviteeCookie },
				...(method === 'GET' ? {} : { body: { invitationId } }),
			},
		);

		expect(response.status).toBe(404);
		const { adapter } = await invitations.auth.$context;
		expect(
			await adapter.findOne({ model: 'invitation', where: [{ field: 'id', value: invitationId }] }),
		).toMatchObject({ status: 'pending' });
	});
});
