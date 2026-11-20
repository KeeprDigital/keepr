import type { TestAccounts } from '~~/test/helpers/keeprAccounts';
import { eq } from 'drizzle-orm';
import { createApp, createRouter, toWebHandler } from 'h3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { identityDatabase, schema } from '~~/server/db';
import accept from '~~/server/api/invitation/accept.post';
import decline from '~~/server/api/invitation/decline.post';
import offer from '~~/server/api/invitation/offer.post';
import listInvitations from '~~/server/api/organisations/[organisationId]/invitations/index.get';
import invite from '~~/server/api/organisations/[organisationId]/invitations/index.post';
import {
	createTestAccounts,
	emailedInvitation,
	fakeBreachedPasswordService,
	LOCAL_HOST,
	PASSWORD,
} from '~~/test/helpers/keeprAccounts';

// Through the route handlers: whoever invites an address with no User, holding
// all Keepr Accounts shows them, cannot become that User. Only the invitee, who
// is emailed the secret, can (ADR-0155).

const running = vi.hoisted(() => {
	// Nitro's auto-import, which the route modules call as they load.
	vi.stubGlobal('defineEventHandler', (handler: unknown) => handler);
	return { accounts: undefined as unknown as TestAccounts };
});

vi.mock('~~/server/utils/auth', async (importOriginal) => ({
	...(await importOriginal<typeof import('~~/server/utils/auth')>()),
	serverAuth: () => running.accounts.auth,
}));
vi.mock('~~/server/db', async (importOriginal) => {
	const original = await importOriginal<typeof import('~~/server/db')>();
	return { ...original, db: () => original.identityDatabase(running.accounts.harness.database) };
});
vi.mock('~~/server/utils/email', () => ({
	serverEmailSender: () => running.accounts.email,
	runAfterResponse: (work: Promise<unknown>) => work,
}));

const OWNER = 'owner@keepr.digital';
const ADMIN = 'admin@keepr.digital';
const INVITEE = 'unregistered@example.com';
const ORIGIN = `http://${LOCAL_HOST}`;

let accounts: TestAccounts;
let organizationId: string;
let send: (request: Request) => Promise<Response>;

beforeEach(async () => {
	fakeBreachedPasswordService();
	accounts = await createTestAccounts();
	running.accounts = accounts;
	await accounts.createUser(OWNER);
	({ id: organizationId } = await accounts.createOrganisation('Keepr', OWNER));
	const { id } = await accounts.createUser(ADMIN);
	await accounts.addMember(id, 'keepr', { role: 'admin' });
	const invitations = '/api/organisations/:organisationId/invitations';
	const router = createRouter()
		.post(invitations, invite)
		.get(invitations, listInvitations)
		.post('/api/invitation/offer', offer)
		.post('/api/invitation/accept', accept)
		.post('/api/invitation/decline', decline);
	send = toWebHandler(createApp().use(router));
});

afterEach(async () => await accounts.harness.close());

/** A request from a page of Keepr Accounts itself, with `cookie` when signed in. */
function fromPage(path: string, { body, cookie }: { body?: unknown; cookie?: string } = {}) {
	return new Request(`${ORIGIN}${path}`, {
		method: body === undefined ? 'GET' : 'POST',
		headers: {
			host: LOCAL_HOST,
			origin: ORIGIN,
			'sec-fetch-site': 'same-origin',
			...(cookie && { cookie }),
			...(body !== undefined && { 'content-type': 'application/json' }),
		},
		...(body !== undefined && { body: JSON.stringify(body) }),
	});
}

async function usersCalled(email: string) {
	return await identityDatabase(accounts.harness.database)
		.select()
		.from(schema.user)
		.where(eq(schema.user.email, email));
}

describe('an admin who invites an address with no User', () => {
	it('holds its id, but cannot read, accept or decline it, nor create the User', async () => {
		const cookie = await accounts.signIn(ADMIN);
		const invited = await send(
			fromPage(`/api/organisations/${organizationId}/invitations`, {
				body: { email: INVITEE, role: 'member', appRoles: {} },
				cookie,
			}),
		);
		expect(invited.status).toBe(200);
		const answered = (await invited.json()) as { invitationId: string };
		const listed = await (
			await send(fromPage(`/api/organisations/${organizationId}/invitations`, { cookie }))
		).json();
		const { invitationId, secret } = emailedInvitation(accounts.email, INVITEE);
		expect(answered).toEqual({ invitationId });
		expect(JSON.stringify(listed)).not.toContain(secret);

		for (const [path, body] of [
			['offer', { invitationId }],
			['accept', { invitationId, name: 'Not The Invitee', password: PASSWORD }],
			['decline', { invitationId }],
		] as const) {
			const response = await send(fromPage(`/api/invitation/${path}`, { body }));
			expect([path, response.status, await response.json()]).toEqual([
				path,
				404,
				expect.objectContaining({ code: 'INVITATION_NOT_FOUND' }),
			]);
		}
		expect(await usersCalled(INVITEE)).toEqual([]);

		const accepted = await send(
			fromPage('/api/invitation/accept', {
				body: { invitationId, secret, name: 'The Invitee', password: PASSWORD },
			}),
		);
		expect(accepted.status).toBe(200);
		expect(await usersCalled(INVITEE)).toEqual([expect.objectContaining({ name: 'The Invitee' })]);
	});
});
