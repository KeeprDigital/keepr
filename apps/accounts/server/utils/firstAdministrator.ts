import type { IdentityDatabase } from '~~/server/db';
import type { KeeprAuth } from './auth';
import { and, eq, gt, isNotNull, isNull, not, or, sql } from 'drizzle-orm';
import { schema } from '~~/server/db';
import { MIN_PASSWORD_LENGTH } from '~~/shared/utils/newPassword';
import { auditRow } from './auditRecord';
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

/** How long a claim works after the command wrote it: a day. */
export const CLAIM_LIFETIME_MS = 24 * 60 * 60 * 1000;

/**
 * How long a claim taken by a request that has not yet created its User holds
 * off every other: a request that stops mid-claim leaves it free again after.
 */
export const CLAIM_TAKING_MS = 5 * 60 * 1000;

const { firstAdministratorClaim: claims, user } = schema;

const noKeeprAdministrator = sql`not exists (select 1 from ${user} where ${userIsKeeprAdministrator})`;

/** Whether a claim is held by a request still creating its User, as of `now`. */
function beingTaken(now: Date) {
	return and(
		isNotNull(claims.consumedAt),
		isNull(claims.consumedByUserId),
		gt(claims.consumedAt, new Date(now.getTime() - CLAIM_TAKING_MS)),
	)!;
}

const notFound = () =>
	new KeeprRefusal(
		404,
		'CLAIM_NOT_FOUND',
		'This link claims nothing. Ask for the command to be run again.',
	);
const expired = () =>
	new KeeprRefusal(
		410,
		'CLAIM_EXPIRED',
		'This link has expired. Ask for the command to be run again.',
	);
const administratorExists = () =>
	new KeeprRefusal(
		409,
		'KEEPR_ADMINISTRATOR_EXISTS',
		'A Keepr Administrator exists, so this claim no longer works.',
	);

async function openClaim(database: IdentityDatabase, claimId: string) {
	const [claim] = await database
		.select({
			email: claims.email,
			createdAt: claims.createdAt,
			consumedByUserId: claims.consumedByUserId,
		})
		.from(claims)
		.where(eq(claims.id, claimId));
	if (!claim) throw notFound();
	const administrators = await database
		.select({ id: user.id })
		.from(user)
		.where(userIsKeeprAdministrator)
		.limit(1);
	if (claim.consumedByUserId !== null || administrators.length > 0) throw administratorExists();
	if (claim.createdAt.getTime() + CLAIM_LIFETIME_MS <= Date.now()) throw expired();
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
 * claims made at once only one can win. The User is created as no Keepr
 * Administrator; one batch then makes them one, with the Keepr Organisation, the
 * claim consumed and the Audit Record. If either step fails, the User is removed
 * and the claim put back to be tried again, so no Keepr Administrator exists
 * without the Keepr Organisation.
 */
export async function claimFirstAdministrator(
	auth: KeeprAuth,
	database: IdentityDatabase,
	{ claimId, name, password }: FirstAdministratorClaiming,
	requestHeaders?: Headers,
): Promise<{ setCookie: string[] }> {
	const { email } = await openClaim(database, claimId);
	// The library's server-side creation does not check the minimum (#1256).
	if (password.length < MIN_PASSWORD_LENGTH)
		throw new KeeprRefusal(400, 'PASSWORD_TOO_SHORT', 'Password too short');

	const now = new Date();
	const taken = await database
		.update(claims)
		.set({ consumedAt: now })
		.where(
			and(
				eq(claims.id, claimId),
				isNull(claims.consumedByUserId),
				or(isNull(claims.consumedAt), not(beingTaken(now))),
				noKeeprAdministrator,
				// No other claim is consumed, or being taken.
				sql`not exists (select 1 from ${claims} as other where other.id <> ${claimId} and (other.consumed_by_user_id is not null or other.consumed_at > ${now.getTime() - CLAIM_TAKING_MS}))`,
			),
		)
		.returning({ id: claims.id });
	if (taken.length === 0) throw administratorExists();
	// Only this taking: one that lapsed and was taken again by another is theirs.
	const putBack = async () =>
		await database
			.update(claims)
			.set({ consumedAt: null })
			.where(
				and(eq(claims.id, claimId), eq(claims.consumedAt, now), isNull(claims.consumedByUserId)),
			);

	let userId: string;
	try {
		// The breached-password check runs here, and a blank name is refused (`userName.ts`).
		const created = await auth.api.createUser({
			body: { email, name, password, data: { emailVerified: true } },
		});
		userId = created.user.id;
	} catch (error) {
		await putBack();
		throw refusalFromAuth(error);
	}

	const organizationId = crypto.randomUUID();
	try {
		await database.batch([
			database
				.update(user)
				.set({ role: KEEPR_ADMINISTRATOR_ROLE, updatedAt: new Date() })
				.where(eq(user.id, userId)),
			database.update(claims).set({ consumedByUserId: userId }).where(eq(claims.id, claimId)),
			auditRow(database, {
				action: 'first-administrator-claim.consumed',
				actorUserId: userId,
				subjectUserId: userId,
				detail: { email },
			}),
			database
				.insert(schema.organization)
				.values({ id: organizationId, ...KEEPR_ORGANISATION, createdAt: new Date() }),
			database.insert(schema.member).values({
				id: crypto.randomUUID(),
				organizationId,
				userId,
				role: 'owner',
				createdAt: new Date(),
			}),
			auditRow(database, {
				action: 'organisation.created',
				actorUserId: userId,
				organizationId,
				detail: { name: KEEPR_ORGANISATION.name },
			}),
		]);
	} catch (error) {
		// Its Sessions and sign-in go with it; it is in no Organisation yet.
		await database.delete(user).where(eq(user.id, userId));
		await putBack();
		throw error;
	}

	const signedIn = await auth.api.signInEmail({
		body: { email, password },
		headers: browserHeaders(requestHeaders),
		returnHeaders: true,
	});
	return { setCookie: signedIn.headers.getSetCookie() };
}
