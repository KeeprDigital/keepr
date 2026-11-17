import type { IdentityDatabase } from '~~/server/db';
import type { KeeprAuth } from './auth';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { schema } from '~~/server/db';
import { MIN_PASSWORD_LENGTH } from '~~/shared/utils/newPassword';
import { recordAudit } from './auditRecord';
import { KEEPR_ADMINISTRATOR_ROLE } from '~~/shared/utils/keeprAdministrator';
import { browserHeaders } from './browserHeaders';
import { userIsKeeprAdministrator } from './keeprAdministrator';
import { KeeprRefusal, refusalFromAuth } from './refusal';

/**
 * Claiming the first Keepr Administrator (ADR-0115). A command writes a First
 * Administrator Claim (`scripts/claim-first-administrator.mjs`); claiming it here
 * creates its address's User as a Keepr Administrator, creates the Keepr
 * Organisation with them as owner, and consumes the claim. It works once, and only
 * while no Keepr Administrator exists. Nothing else makes a Keepr Administrator.
 */

/** The Organisation the first Keepr Administrator owns. */
export const KEEPR_ORGANISATION = { name: 'Keepr', slug: 'keepr' } as const;

const { firstAdministratorClaim: claims, user } = schema;

const noKeeprAdministrator = sql`not exists (select 1 from ${user} where ${userIsKeeprAdministrator})`;

const notFound = () =>
	new KeeprRefusal(
		404,
		'CLAIM_NOT_FOUND',
		'This link claims nothing. Ask for the command to be run again.',
	);
const administratorExists = () =>
	new KeeprRefusal(
		409,
		'KEEPR_ADMINISTRATOR_EXISTS',
		'A Keepr Administrator exists, so this claim no longer works.',
	);

async function openClaim(database: IdentityDatabase, claimId: string) {
	const [claim] = await database
		.select({ email: claims.email, consumedAt: claims.consumedAt })
		.from(claims)
		.where(eq(claims.id, claimId));
	if (!claim) throw notFound();
	const administrators = await database
		.select({ id: user.id })
		.from(user)
		.where(userIsKeeprAdministrator)
		.limit(1);
	if (claim.consumedAt !== null || administrators.length > 0) throw administratorExists();
	return claim;
}

/** What the claim page shows before claiming: the address the User will have. */
export async function firstAdministratorClaimOffer(
	_auth: KeeprAuth,
	database: IdentityDatabase,
	claimId: string,
): Promise<{ email: string }> {
	const { email } = await openClaim(database, claimId);
	return { email };
}

export interface FirstAdministratorClaiming {
	claimId: string;
	name: string;
	password: string;
}

/**
 * Claims `claimId`, answering the cookies that sign the new Keepr Administrator in.
 * The claim is taken by one conditional write before the User exists, so of two
 * claims made at once only one can win; if the User then cannot be created, the
 * claim is put back to be tried again.
 */
export async function claimFirstAdministrator(
	auth: KeeprAuth,
	database: IdentityDatabase,
	{ claimId, name, password }: FirstAdministratorClaiming,
	requestHeaders?: Headers,
): Promise<{ setCookie: string[] }> {
	const { email } = await openClaim(database, claimId);
	if (name.trim().length === 0) throw new KeeprRefusal(400, 'NAME_REQUIRED', 'Enter your name.');
	// The library's server-side creation does not check the minimum (#1256).
	if (password.length < MIN_PASSWORD_LENGTH)
		throw new KeeprRefusal(400, 'PASSWORD_TOO_SHORT', 'Password too short');

	const taken = await database
		.update(claims)
		.set({ consumedAt: new Date() })
		.where(
			and(
				eq(claims.id, claimId),
				isNull(claims.consumedAt),
				noKeeprAdministrator,
				sql`not exists (select 1 from ${claims} where ${claims.consumedAt} is not null)`,
			),
		)
		.returning({ id: claims.id });
	if (taken.length === 0) throw administratorExists();

	let userId: string;
	try {
		// The breached-password check runs here.
		const created = await auth.api.createUser({
			body: {
				email,
				name: name.trim(),
				password,
				role: KEEPR_ADMINISTRATOR_ROLE,
				data: { emailVerified: true },
			},
		});
		userId = created.user.id;
	} catch (error) {
		await database.update(claims).set({ consumedAt: null }).where(eq(claims.id, claimId));
		throw refusalFromAuth(error);
	}

	await database.update(claims).set({ consumedByUserId: userId }).where(eq(claims.id, claimId));
	await recordAudit(database, {
		action: 'first-administrator-claim.consumed',
		actorUserId: userId,
		subjectUserId: userId,
		detail: { email },
	});
	// Recorded as created by its owner (`organisationOptions`).
	await auth.api.createOrganization({ body: { ...KEEPR_ORGANISATION, userId } });

	const signedIn = await auth.api.signInEmail({
		body: { email, password },
		headers: browserHeaders(requestHeaders),
		returnHeaders: true,
	});
	return { setCookie: signedIn.headers.getSetCookie() };
}
