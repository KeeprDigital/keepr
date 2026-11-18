import type { TestAccounts } from '~~/test/helpers/keeprAccounts';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { identityDatabase, schema } from '~~/server/db';
import {
	claimFirstAdministrator,
	firstAdministratorClaimOffer,
} from '~~/server/utils/firstAdministrator';
import {
	createTestAccounts,
	fakeBreachedPasswordService,
	PASSWORD,
} from '~~/test/helpers/keeprAccounts';
import {
	firstAdministratorClaimSql,
	firstAdministratorClaimTarget,
} from '../../../scripts/claim-first-administrator.mjs';

// The first Keepr Administrator: a command writes a one-time claim for an address,
// and the claim page makes that address's User a Keepr Administrator and owner of
// the Keepr Organisation, once, and only while no Keepr Administrator exists.

const FOUNDER = 'founder@keepr.digital';
const BREACHED = 'a-password-from-a-breach';

let accounts: TestAccounts;
let database: ReturnType<typeof identityDatabase>;

beforeEach(async () => {
	fakeBreachedPasswordService([BREACHED]);
	accounts = await createTestAccounts();
	database = identityDatabase(accounts.harness.database);
});

afterEach(async () => await accounts.harness.close());

let claims = 0;
/** Runs the command's statements against the identity database, as `wrangler d1 execute` would. */
async function writeClaim(email = FOUNDER) {
	const claimId = `claim-${++claims}`;
	await accounts.harness.client.executeMultiple(
		firstAdministratorClaimSql({ email, claimId, at: new Date(), by: 'the operator' }),
	);
	return claimId;
}

async function claim(claimId: string, password = PASSWORD) {
	return await claimFirstAdministrator(accounts.auth, database, {
		claimId,
		name: 'Founder',
		password,
	});
}

async function signedInAs(setCookie: string[]) {
	const cookie = setCookie.map((value) => value.split(';')[0]).join('; ');
	const response = await accounts.send('/get-session', { headers: { cookie } });
	return (await response.json()) as { user: { email: string; role: string } } | null;
}

describe('the command', () => {
	it('writes a claim for the address, and its making in the Audit Record', async () => {
		const claimId = await writeClaim('Founder@Keepr.Digital');

		expect(await firstAdministratorClaimOffer(accounts.auth, database, claimId)).toEqual({
			email: FOUNDER,
		});
		expect(await accounts.auditRecord()).toEqual([
			expect.objectContaining({
				action: 'first-administrator-claim.made',
				actorUserId: null,
				at: expect.any(Date),
			}),
		]);
		expect(JSON.parse((await accounts.auditRecord())[0]!.detail!)).toEqual({
			email: FOUNDER,
			by: 'the operator',
		});
	});

	it('writes nothing once a Keepr Administrator exists', async () => {
		await accounts.createUser('administrator@keepr.digital', { role: 'admin' });

		await writeClaim();

		expect(await database.select().from(schema.firstAdministratorClaim)).toEqual([]);
		expect(await accounts.auditRecord()).toEqual([]);
	});

	// Each Installation's database is reached in its own account, and its claim page is its own.
	it.each([
		[
			'the local database',
			[],
			['DB', '--local', '--config', 'wrangler.dev.jsonc'],
			'http://localhost:3000',
		],
		[
			"production's",
			['--remote', 'accounts-identity'],
			['accounts-identity', '--remote', '--config', 'wrangler.jsonc'],
			'https://accounts.keepr.digital',
		],
		[
			"staging's",
			['--remote', 'accounts-identity', '--env', 'staging'],
			['accounts-identity', '--remote', '--config', 'wrangler.jsonc', '--env', 'staging'],
			'https://accounts.keepr-staging.digital',
		],
	])('writes to %s', (_case, flags, database, origin) => {
		expect(firstAdministratorClaimTarget(flags)).toEqual({ database, origin });
	});

	it.each([
		['--remote with no database', ['--remote']],
		['an Environment with no Installation', ['--remote', 'accounts-identity', '--env', 'dev']],
		['an Environment for the local database', ['--env', 'staging']],
	])('refuses %s', (_case, flags) => {
		expect(() => firstAdministratorClaimTarget(flags)).toThrow(/Usage|Installation/);
	});

	it.each([['not an address'], ["o'brien@keepr.digital'); DROP TABLE user; --"]])(
		'refuses %s',
		(email) => {
			expect(() =>
				firstAdministratorClaimSql({ email, claimId: 'claim', at: new Date(), by: 'x' }),
			).toThrow(/address/);
		},
	);
});

describe('claiming', () => {
	it('makes a signed-in Keepr Administrator, owner of the Keepr Organisation', async () => {
		const { setCookie } = await claim(await writeClaim());

		expect(await signedInAs(setCookie)).toMatchObject({
			user: { email: FOUNDER, role: 'admin' },
		});
		const [user] = await database.select().from(schema.user).where(eq(schema.user.email, FOUNDER));
		expect(user).toMatchObject({ emailVerified: true, name: 'Founder' });
		const memberships = await database
			.select({ role: schema.member.role, name: schema.organization.name })
			.from(schema.member)
			.innerJoin(schema.organization, eq(schema.member.organizationId, schema.organization.id))
			.where(eq(schema.member.userId, user!.id));
		expect(memberships).toEqual([{ role: 'owner', name: 'Keepr' }]);
	});

	it('consumes the claim, and records its consuming and the Organisation created', async () => {
		const claimId = await writeClaim();

		await claim(claimId);

		const [user] = await database.select().from(schema.user).where(eq(schema.user.email, FOUNDER));
		const [row] = await database.select().from(schema.firstAdministratorClaim);
		expect(row).toMatchObject({ consumedAt: expect.any(Date), consumedByUserId: user!.id });
		const record = await accounts.auditRecord();
		expect(record.map((entry) => [entry.action, entry.actorUserId])).toEqual([
			['first-administrator-claim.made', null],
			['first-administrator-claim.consumed', user!.id],
			['organisation.created', user!.id],
		]);
		expect(record[1]).toMatchObject({ subjectUserId: user!.id });
		expect(record[2]).toMatchObject({ organizationId: expect.any(String) });
	});

	it.each([
		['the same claim a second time', 'same'],
		['another claim once a Keepr Administrator exists', 'another'],
	])('refuses %s', async (_case, which) => {
		const first = await writeClaim();
		const second = await writeClaim('second@keepr.digital');
		await claim(first);

		const again = which === 'same' ? first : second;

		const refused = { statusCode: 409, code: 'KEEPR_ADMINISTRATOR_EXISTS' };
		await expect(
			firstAdministratorClaimOffer(accounts.auth, database, again),
		).rejects.toMatchObject(refused);
		await expect(claim(again)).rejects.toMatchObject(refused);
		expect(await database.select().from(schema.user)).toHaveLength(1);
	});

	it('refuses a claim no command wrote', async () => {
		await expect(claim('no-such-claim')).rejects.toMatchObject({
			statusCode: 404,
			code: 'CLAIM_NOT_FOUND',
		});
	});

	it.each([
		['a password under the minimum', 'short', 'PASSWORD_TOO_SHORT'],
		['a password from a breach', BREACHED, 'PASSWORD_COMPROMISED'],
	])('refuses %s, leaving the claim to try again', async (_case, password, code) => {
		const claimId = await writeClaim();

		await expect(claim(claimId, password)).rejects.toMatchObject({ statusCode: 400, code });
		expect(await database.select().from(schema.user)).toEqual([]);

		await claim(claimId);
		expect(await database.select().from(schema.user)).toHaveLength(1);
	});
});
