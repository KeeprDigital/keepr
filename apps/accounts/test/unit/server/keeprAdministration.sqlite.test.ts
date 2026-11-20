import type { IdentityDatabase } from '~~/server/db';
import type { KeeprRefusal } from '~~/server/utils/refusal';
import type { NewOrganisation } from '~~/server/utils/keeprAdministration';
import type { TestAccounts } from '~~/test/helpers/keeprAccounts';
import { decodeJwt } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { identityDatabase, schema } from '~~/server/db';
import { requestActor } from '~~/server/utils/actor';
import { acceptInvitationAsNewUser } from '~~/server/utils/invitationAcceptance';
import { inviteMember } from '~~/server/utils/invitations';
import {
	createOrganisation,
	disableUser,
	enableUser,
	findUsers,
	grantKeeprAdministrator,
	listOrganisations,
	readAuditRecord,
} from '~~/server/utils/keeprAdministration';
import { listMembers } from '~~/server/utils/memberManagement';
import {
	createTestAccounts,
	emailedInvitation,
	fakeBreachedPasswordService,
	PASSWORD,
} from '~~/test/helpers/keeprAccounts';

// A Keepr Administrator runs the platform from Keepr Accounts' own routes: request
// in, outcome out, as the rows stored, the email sent and the Audit Record.

const ADMINISTRATOR = 'administrator@keepr.digital';
const ORIGIN = 'http://localhost:3000';
const FIRST_OWNER = 'first-owner@club.example';

let accounts: TestAccounts;
let database: IdentityDatabase;

beforeEach(async () => {
	fakeBreachedPasswordService();
	accounts = await createTestAccounts();
	database = identityDatabase(accounts.harness.database);
	await accounts.createUser(ADMINISTRATOR, { role: 'admin' });
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
		new Request(`${ORIGIN}/api/platform`, {
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

/** The Audit Record's rows for `action`, their detail read. */
async function audited(action: string) {
	return (await accounts.auditRecord())
		.filter((row) => row.action === action)
		.map((row) => ({ ...row, detail: row.detail === null ? null : JSON.parse(row.detail) }));
}

async function createClub(appRoles: Record<string, string> = {}) {
	return await createOrganisation(
		database,
		await actorFor(ADMINISTRATOR, 'POST'),
		{ name: 'The Club', ownerEmail: FIRST_OWNER, appRoles },
		{ email: accounts.email, origin: ORIGIN },
	);
}

describe('an Organisation a Keepr Administrator creates', () => {
	it('is listed, with no member until its first owner accepts their Invitation', async () => {
		const { organisation } = await createClub();

		expect(await listOrganisations(database, await actorFor(ADMINISTRATOR))).toEqual([
			expect.objectContaining({ id: organisation.id, name: 'The Club', members: 0 }),
		]);
	});

	it('is run by the first owner it names, once they accept the emailed Invitation', async () => {
		const created = await createClub({ stream: 'admin' });
		const emailed = emailedInvitation(accounts.email, FIRST_OWNER);

		expect(created).toEqual({
			organisation: created.organisation,
			invitationId: emailed.invitationId,
		});
		await acceptInvitationAsNewUser(accounts.auth, database, {
			...emailed,
			name: 'First Owner',
			password: 'a-long-enough-password',
		});
		const { organisation } = created;
		const { members } = await listMembers(database, await actorFor(ADMINISTRATOR), organisation.id);
		expect(members).toEqual([
			expect.objectContaining({ email: FIRST_OWNER, role: 'owner', apps: { stream: 'admin' } }),
		]);
	});
});

type TestActor = Awaited<ReturnType<typeof actorFor>>;

/** An ordinary User, signed in just now. */
async function ordinaryUser(method = 'POST'): Promise<TestActor> {
	await accounts.createUser('ordinary@keepr.digital');
	return await actorFor('ordinary@keepr.digital', method);
}

/** The Keepr Administrator, eleven minutes after signing in. */
async function staleAdministrator(): Promise<TestActor> {
	vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-17T10:00:00Z') });
	const actor = await actorFor(ADMINISTRATOR, 'POST');
	vi.setSystemTime(new Date('2026-11-17T10:11:00Z'));
	return actor;
}

async function administrator(): Promise<TestActor> {
	return await actorFor(ADMINISTRATOR, 'POST');
}

describe('creating an Organisation', () => {
	it.each<[string, string, Partial<NewOrganisation>, () => Promise<TestActor>]>([
		['by an ordinary User', 'NOT_A_KEEPR_ADMINISTRATOR', {}, ordinaryUser],
		['eleven minutes after signing in', 'RECENT_SIGN_IN_REQUIRED', {}, staleAdministrator],
		['with no name', 'NAME_REQUIRED', { name: '  ' }, administrator],
		['with no owner’s address', 'INVALID_EMAIL', { ownerEmail: 'nobody' }, administrator],
		[
			'offering an App role the registry does not name',
			'APP_ROLE_NOT_IN_REGISTRY',
			{ appRoles: { stream: 'owner' } },
			administrator,
		],
	])('%s is refused %s, and creates nothing', async (_case, refusal, input, actor) => {
		const creating = await outcome(
			createOrganisation(
				database,
				await actor(),
				{ name: 'The Club', ownerEmail: FIRST_OWNER, ...input },
				{ email: accounts.email, origin: ORIGIN },
			),
		);

		expect(creating).toMatchObject({ refused: refusal });
		vi.useRealTimers();
		expect(await listOrganisations(database, await actorFor(ADMINISTRATOR))).toEqual([]);
		expect(accounts.email.sent).toEqual([]);
		expect(await accounts.auditRecord()).toEqual([]);
	});

	it('under a name another Organisation has is refused, and creates nothing more', async () => {
		await createClub();

		const again = await outcome(createClub());

		expect(again).toEqual({ refused: 'ORGANISATION_EXISTS', statusCode: 409 });
		expect(await listOrganisations(database, await actorFor(ADMINISTRATOR))).toHaveLength(1);
		expect(accounts.email.sent).toHaveLength(1);
	});

	// Names are compared by their letters and digits in any script, so one with
	// no ASCII letter is still unique, and a non-ASCII letter is not dropped.
	it.each([
		['the same name in another case', 'The Club', 'the-club', 'ORGANISATION_EXISTS'],
		['a name of no ASCII letter, twice', '日本', '日本', 'ORGANISATION_EXISTS'],
		['the same name of no letter at all, twice', '!!!', '!!!', 'ORGANISATION_EXISTS'],
		['a name that differs by a non-ASCII letter', 'Škoda', 'koda', undefined],
	])('under %s', async (_case, first, second, refusal) => {
		const actor = await administrator();
		const create = async (name: string) =>
			await outcome(
				createOrganisation(
					database,
					actor,
					{ name, ownerEmail: FIRST_OWNER },
					{ email: accounts.email, origin: ORIGIN },
				),
			);
		await create(first);

		const again = await create(second);

		expect(again).toMatchObject(
			refusal === undefined ? { organisation: { name: second } } : { refused: refusal },
		);
		expect(await listOrganisations(database, actor)).toHaveLength(refusal === undefined ? 2 : 1);
	});

	it('that fails before its Invitation is written leaves nothing half-written', async () => {
		await accounts.failInsertsInto('invitation');

		await expect(createClub()).rejects.toThrow(/injected failure/);

		expect(await listOrganisations(database, await administrator())).toEqual([]);
		expect(await accounts.auditRecord()).toEqual([]);
		expect(accounts.email.sent).toEqual([]);
	});

	it('is in the Audit Record: the Organisation created and its first owner invited', async () => {
		const actor = await actorFor(ADMINISTRATOR, 'POST');
		const { organisation, invitationId } = await createOrganisation(
			database,
			actor,
			{ name: 'The Club', ownerEmail: FIRST_OWNER, appRoles: { score: 'member' } },
			{ email: accounts.email, origin: ORIGIN },
		);

		const who = {
			actorUserId: actor.userId,
			organizationId: organisation.id,
			at: expect.any(Date),
		};
		expect(await audited('organisation.created')).toEqual([
			expect.objectContaining({ ...who, detail: { name: 'The Club', as: 'keepr-administrator' } }),
		]);
		expect(await audited('invitation.created')).toEqual([
			expect.objectContaining({
				...who,
				detail: {
					invitationId,
					email: FIRST_OWNER,
					role: 'owner',
					appRoles: { score: 'member' },
					as: 'keepr-administrator',
				},
			}),
		]);
	});

	// Being a Keepr Administrator grants no App access: creating an Organisation
	// makes them no member of it, so their Identity Proof names none.
	it('leaves the Keepr Administrator outside it, with no App access', async () => {
		await createClub({ stream: 'admin' });

		const response = await accounts.send('/token', {
			headers: { cookie: await accounts.signIn(ADMINISTRATOR) },
		});
		const { token } = (await response.json()) as { token: string };

		expect(decodeJwt(token)).toMatchObject({ keeprAdmin: true, org: null, apps: {} });
	});
});

describe('finding a User', () => {
	beforeEach(async () => {
		await accounts.createUser('grace.hopper@navy.example');
		await accounts.createUser('ada@keepr.digital');
	});

	it.each([
		['by part of their email', 'NAVY', ['grace.hopper@navy.example']],
		['by part of their name', 'hopp', ['grace.hopper@navy.example']],
		['where a wildcard is only a character', '%', []],
		['where nobody matches', 'turing', []],
	])('%s', async (_case, query, emails) => {
		const found = await findUsers(database, await actorFor(ADMINISTRATOR), query);

		expect(found.map(({ email }) => email)).toEqual(emails);
	});

	it('shows whether each is disabled, and a Keepr Administrator', async () => {
		const found = await findUsers(database, await actorFor(ADMINISTRATOR), 'keepr.digital');

		expect(found).toEqual([
			expect.objectContaining({
				email: 'ada@keepr.digital',
				disabled: false,
				keeprAdministrator: false,
			}),
			expect.objectContaining({ email: ADMINISTRATOR, disabled: false, keeprAdministrator: true }),
		]);
	});

	it('is closed to an ordinary User', async () => {
		expect(await outcome(findUsers(database, await ordinaryUser('GET'), 'ada'))).toEqual({
			refused: 'NOT_A_KEEPR_ADMINISTRATOR',
			statusCode: 403,
		});
	});
});

describe('disabling a User', () => {
	const ADA = 'ada@keepr.digital';
	let ada: { id: string };

	beforeEach(async () => {
		ada = await accounts.createUser(ADA);
	});

	async function signedIn(cookie: string) {
		const response = await accounts.send('/get-session', { headers: { cookie } });
		return (await response.json()) !== null;
	}

	let clients = 0;

	/** Ada's sign-in from a client of its own, so no rate limit is met: its status. */
	async function adaSignsIn() {
		const response = await accounts.send('/sign-in/email', {
			body: { email: ADA, password: PASSWORD },
			headers: { 'cf-connecting-ip': `192.0.2.${(clients += 1)}` },
		});
		return response.status;
	}

	it('ends every Session they have, and they cannot sign in until re-enabled', async () => {
		const laptop = await accounts.signIn(ADA);
		const phone = await accounts.signIn(ADA);
		const actor = await administrator();

		await disableUser(database, actor, ada.id);

		expect([await signedIn(laptop), await signedIn(phone)]).toEqual([false, false]);
		expect(await adaSignsIn()).toBe(403);
		expect(await findUsers(database, actor, ADA)).toEqual([
			expect.objectContaining({ disabled: true }),
		]);

		await enableUser(database, actor, ada.id);

		expect(await adaSignsIn()).toBe(200);
		expect(await findUsers(database, actor, ADA)).toEqual([
			expect.objectContaining({ disabled: false }),
		]);
	});

	it('and re-enabling them are in the Audit Record, the Sessions ended a row of its own', async () => {
		await accounts.signIn(ADA);
		await accounts.signIn(ADA);
		const actor = await administrator();

		await disableUser(database, actor, ada.id);
		await enableUser(database, actor, ada.id);

		const who = { actorUserId: actor.userId, subjectUserId: ada.id, at: expect.any(Date) };
		expect(await audited('user.disabled')).toEqual([expect.objectContaining(who)]);
		expect(await audited('user.sessions-ended')).toEqual([
			expect.objectContaining({ ...who, detail: { sessionsEnded: 2 } }),
		]);
		expect(await audited('user.enabled')).toEqual([expect.objectContaining(who)]);
	});

	it('cancels the Invitations they offered that are still open, in every Organisation', async () => {
		const offered: string[] = [];
		for (const slug of ['first', 'second']) {
			const { organizationId } = await accounts.addMember(ada.id, slug, { role: 'owner' });
			const { invitationId } = await inviteMember(
				database,
				await actorFor(ADA, 'POST'),
				{ organizationId, email: `${slug}@example.com`, role: 'member' },
				{ email: accounts.email, origin: ORIGIN },
			);
			offered.push(invitationId);
		}
		const actor = await administrator();

		await disableUser(database, actor, ada.id);

		const statuses = await database
			.select({ status: schema.invitation.status })
			.from(schema.invitation)
			.where(eq(schema.invitation.inviterId, ada.id));
		expect(statuses).toEqual([{ status: 'canceled' }, { status: 'canceled' }]);
		expect(
			(await audited('invitation.cancelled')).map(({ actorUserId, detail }) => ({
				actorUserId,
				detail,
			})),
		).toEqual(
			expect.arrayContaining(
				offered.map((invitationId, n) => ({
					actorUserId: actor.userId,
					detail: {
						invitationId,
						email: `${['first', 'second'][n]}@example.com`,
						as: 'keepr-administrator',
						because: 'inviter-disabled',
					},
				})),
			),
		);
		expect(await audited('invitation.cancelled')).toHaveLength(2);
	});

	it('that fails before its Audit Record is written leaves them enabled and signed in', async () => {
		const laptop = await accounts.signIn(ADA);
		const actor = await administrator();
		await accounts.failInsertsInto('auditRecord');

		await expect(disableUser(database, actor, ada.id)).rejects.toThrow(/injected failure/);

		expect(await signedIn(laptop)).toBe(true);
		expect(await findUsers(database, actor, ADA)).toEqual([
			expect.objectContaining({ disabled: false }),
		]);
	});

	it.each<[string, string, () => Promise<TestActor>, () => string]>([
		['by an ordinary User', 'NOT_A_KEEPR_ADMINISTRATOR', ordinaryUser, () => ada.id],
		[
			'eleven minutes after signing in',
			'RECENT_SIGN_IN_REQUIRED',
			staleAdministrator,
			() => ada.id,
		],
		['of a User who does not exist', 'USER_NOT_FOUND', administrator, () => 'nobody'],
	])('%s is refused %s, and changes nothing', async (_case, refusal, actor, userId) => {
		const cookie = await accounts.signIn(ADA);

		expect(await outcome(disableUser(database, await actor(), userId()))).toMatchObject({
			refused: refusal,
		});
		vi.useRealTimers();
		expect(await signedIn(cookie)).toBe(true);
		expect(await audited('user.disabled')).toEqual([]);
	});

	it('of themselves is refused, so a Keepr Administrator cannot shut themselves out', async () => {
		const actor = await administrator();

		expect(await outcome(disableUser(database, actor, actor.userId))).toEqual({
			refused: 'CANNOT_DISABLE_SELF',
			statusCode: 409,
		});
	});

	it.each<[string, string, () => Promise<TestActor>]>([
		['by an ordinary User', 'NOT_A_KEEPR_ADMINISTRATOR', ordinaryUser],
		['eleven minutes after signing in', 'RECENT_SIGN_IN_REQUIRED', staleAdministrator],
	])('re-enabled %s is refused %s, and stays disabled', async (_case, refusal, actor) => {
		await disableUser(database, await administrator(), ada.id);

		expect(await outcome(enableUser(database, await actor(), ada.id))).toMatchObject({
			refused: refusal,
		});
		vi.useRealTimers();
		expect(await adaSignsIn()).toBe(403);
	});
});

// A Keepr Administrator makes another, so that one who is compromised can be
// disabled by the other (ADR-0156).
describe('granting a User Keepr Administrator', () => {
	const ADA = 'ada@keepr.digital';
	let ada: { id: string };

	beforeEach(async () => {
		ada = await accounts.createUser(ADA);
	});

	it('makes them one, who can then disable the Keepr Administrator who granted it', async () => {
		const granter = await administrator();

		await grantKeeprAdministrator(database, granter, ada.id);

		expect(await findUsers(database, granter, ADA)).toEqual([
			expect.objectContaining({ keeprAdministrator: true }),
		]);
		await disableUser(database, await actorFor(ADA, 'POST'), granter.userId);
		expect(await findUsers(database, await actorFor(ADA), ADMINISTRATOR)).toEqual([
			expect.objectContaining({ disabled: true }),
		]);
	});

	it('is in the Audit Record, naming who granted it to whom', async () => {
		const granter = await administrator();

		await grantKeeprAdministrator(database, granter, ada.id);

		expect(await audited('user.keepr-administrator-granted')).toEqual([
			expect.objectContaining({
				actorUserId: granter.userId,
				subjectUserId: ada.id,
				at: expect.any(Date),
			}),
		]);
	});

	it.each<[string, string, () => Promise<TestActor>, () => string]>([
		['by an ordinary User', 'NOT_A_KEEPR_ADMINISTRATOR', ordinaryUser, () => ada.id],
		[
			'eleven minutes after signing in',
			'RECENT_SIGN_IN_REQUIRED',
			staleAdministrator,
			() => ada.id,
		],
		['to a User who does not exist', 'USER_NOT_FOUND', administrator, () => 'nobody'],
	])('%s is refused %s, and grants nothing', async (_case, refusal, actor, userId) => {
		expect(await outcome(grantKeeprAdministrator(database, await actor(), userId()))).toMatchObject(
			{ refused: refusal },
		);
		vi.useRealTimers();
		expect(await findUsers(database, await administrator(), ADA)).toEqual([
			expect.objectContaining({ keeprAdministrator: false }),
		]);
		expect(await audited('user.keepr-administrator-granted')).toEqual([]);
	});

	it('to one already is refused, and records nothing', async () => {
		const granter = await administrator();
		await grantKeeprAdministrator(database, granter, ada.id);

		expect(await outcome(grantKeeprAdministrator(database, granter, ada.id))).toEqual({
			refused: 'ALREADY_A_KEEPR_ADMINISTRATOR',
			statusCode: 409,
		});
		expect(await audited('user.keepr-administrator-granted')).toHaveLength(1);
	});
});

describe('the Audit Record a Keepr Administrator sees', () => {
	it('is every action, newest first, naming who acted, on whom and in which Organisation', async () => {
		const actor = await administrator();
		const { organisation, invitationId } = await createClub();
		const ada = await accounts.createUser('ada@keepr.digital');
		await disableUser(database, actor, ada.id);

		const seen = await readAuditRecord(database, actor);

		const administratorNamed = { id: actor.userId, name: 'administrator', email: ADMINISTRATOR };
		const club = { id: organisation.id, name: 'The Club' };
		expect(seen).toEqual([
			{
				id: expect.any(String),
				at: expect.any(String),
				action: 'user.sessions-ended',
				actor: administratorNamed,
				subject: { id: ada.id, name: 'ada', email: 'ada@keepr.digital' },
				organisation: null,
				detail: { sessionsEnded: 0 },
			},
			expect.objectContaining({ action: 'user.disabled', detail: null }),
			expect.objectContaining({
				action: 'invitation.created',
				organisation: club,
				detail: expect.objectContaining({ invitationId }),
			}),
			expect.objectContaining({
				action: 'organisation.created',
				actor: administratorNamed,
				subject: null,
				organisation: club,
			}),
		]);
	});

	// A row's `at` is stamped as its statement is built, so one written later can
	// read earlier: within a batch, or from an isolate whose clock is behind.
	it('lists the row written last first, whatever its time says', async () => {
		const actor = await administrator();
		const ada = await accounts.createUser('ada@keepr.digital');
		const written = [new Date('2026-11-17T10:00:01Z'), new Date('2026-11-17T10:00:00Z')];
		for (const [n, at] of written.entries())
			await database.insert(schema.auditRecord).values({
				id: `row-${n}`,
				at,
				action: 'user.enabled',
				actorUserId: actor.userId,
				subjectUserId: ada.id,
			});

		const seen = await readAuditRecord(database, actor);

		expect(seen.map(({ id }) => id).filter((id) => id.startsWith('row-'))).toEqual([
			'row-1',
			'row-0',
		]);
	});

	it('is closed to an ordinary User', async () => {
		expect(await outcome(readAuditRecord(database, await ordinaryUser('GET')))).toEqual({
			refused: 'NOT_A_KEEPR_ADMINISTRATOR',
			statusCode: 403,
		});
	});
});

describe('the Organisations listed', () => {
	it('are closed to an ordinary User', async () => {
		expect(await outcome(listOrganisations(database, await ordinaryUser('GET')))).toEqual({
			refused: 'NOT_A_KEEPR_ADMINISTRATOR',
			statusCode: 403,
		});
	});
});
