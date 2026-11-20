import type { IdentityDatabase } from '~~/server/db';
import type { EmailSender } from '~~/server/email/sender';
import type { Actor } from './actor';
import type { AppRoles } from './appAccess';
import type { ManagingStanding } from './memberManagement';
import { and, asc, count, eq, gt, ne } from 'drizzle-orm';
import { isOrganisationRole } from '@keepr/nuxt-layer/shared/utils/identityProof';
import { schema } from '~~/server/db';
import { invitationEmail } from '~~/server/email/messages';
import { invitationLink } from '~~/shared/utils/invitationLink';
import { offeredAppRoles } from './appAccess';
import { recordAudit } from './auditRecord';
import {
	INVITATION_EXPIRES_IN_SECONDS,
	INVITATION_LIMIT,
	INVITATIONS_PER_INVITER_PER_HOUR,
} from './authOptions';
import { newInvitationSecret } from './invitationSecret';
import { managingChange, managingStanding, ownerRequired } from './memberManagement';
import { KeeprRefusal, refusalFromAuth } from './refusal';

/**
 * Inviting to an Organisation, and its pending Invitations, through Keepr
 * Accounts' own routes (ADR-0114, ADR-0116): who may is `managingStanding`'s
 * answer, so a Keepr Administrator invites to any Organisation as its owner
 * would (#1228 story 48). The library's invite, list and cancel routes stay
 * closed (`MEMBER_PATHS_KEEPR_SERVES`).
 */

/** How an Invitation's email is sent, and from which origin its link is named. */
export interface InvitationSending {
	email: EmailSender;
	origin: string;
	/** Takes the send, so the response does not wait for it; without one, it waits. */
	afterResponse?: (work: Promise<unknown>) => unknown;
}

/** An Invitation made. Its link is emailed to the invitee alone, and answered to nobody. */
export interface CreatedInvitation {
	invitationId: string;
}

/**
 * Invites `email` to `organisation`: the address's pending Invitation there is
 * replaced, each replacement a cancellation in the Audit Record, and the email,
 * whose link carries the Invitation's secret, is sent after answering. A failed
 * send leaves the Invitation standing.
 */
export async function issueInvitation(
	database: IdentityDatabase,
	{
		organisation,
		email,
		role,
		appRoles,
		inviterId,
		as,
	}: {
		organisation: { id: string; name: string };
		email: string;
		role: string;
		appRoles: AppRoles;
		inviterId: string;
		as: ManagingStanding;
	},
	{ email: sender, origin, afterResponse = (work) => work }: InvitationSending,
): Promise<CreatedInvitation> {
	const now = new Date();
	const invitationId = crypto.randomUUID();
	const replaced = await database
		.update(schema.invitation)
		.set({ status: 'canceled' })
		.where(
			and(
				eq(schema.invitation.organizationId, organisation.id),
				eq(schema.invitation.email, email),
				eq(schema.invitation.status, 'pending'),
				// Checked before (`pendingOwnerOffer`), and held here: an admin never
				// replaces an offer to an owner, even one made in between.
				as === 'admin' ? ne(schema.invitation.role, 'owner') : undefined,
			),
		)
		.returning({ id: schema.invitation.id });
	const { secret, digest } = await newInvitationSecret();
	// One write, so no Invitation stands without its secret.
	await database.batch([
		database.insert(schema.invitation).values({
			id: invitationId,
			organizationId: organisation.id,
			email,
			role,
			status: 'pending',
			expiresAt: new Date(now.getTime() + INVITATION_EXPIRES_IN_SECONDS * 1000),
			createdAt: now,
			inviterId,
			appRoles: JSON.stringify(appRoles),
		}),
		database.insert(schema.invitationSecret).values({ invitationId, digest }),
	]);
	await recordAudit(database, {
		action: 'invitation.created',
		actorUserId: inviterId,
		organizationId: organisation.id,
		detail: { invitationId, email, role, appRoles, as },
	});
	for (const { id } of replaced)
		await recordAudit(database, {
			action: 'invitation.cancelled',
			actorUserId: inviterId,
			organizationId: organisation.id,
			detail: { invitationId: id, email, replacedBy: invitationId, as },
		});

	const [inviter] = await database
		.select({ name: schema.user.name })
		.from(schema.user)
		.where(eq(schema.user.id, inviterId));
	await afterResponse(
		sender.send(
			invitationEmail({
				to: email,
				inviterName: inviter?.name ?? 'Someone',
				organisationName: organisation.name,
				link: invitationLink(origin, invitationId, secret),
			}),
		),
	);
	return { invitationId };
}

/**
 * One mailbox, as `local@domain.tld`: no list of addresses, no display name, a
 * domain of dot-separated labels. Plausible, not proven: the emailed link proves
 * it.
 */
const SINGLE_ADDRESS =
	/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

/** The longest address a mailbox can have. */
const MAX_ADDRESS_LENGTH = 254;

/** An email address as an Invitation is made to it, or `null` for one that is none. */
export function invitedAddress(email: string): string | null {
	const address = email.trim().toLowerCase();
	return address.length <= MAX_ADDRESS_LENGTH && SINGLE_ADDRESS.test(address) ? address : null;
}

export interface NewInvitation {
	organizationId: string;
	email: string;
	role: string;
	/** The App roles offered, as the request carried them. */
	appRoles?: unknown;
}

/**
 * Invites an address to an Organisation, by an owner, an admin or a Keepr
 * Administrator, from a recent sign-in; only an owner or a Keepr Administrator
 * invites an owner, or replaces an offer to one. Refused, nothing is invited or
 * emailed.
 */
export async function inviteMember(
	database: IdentityDatabase,
	actor: Actor,
	{ organizationId, email, role, appRoles }: NewInvitation,
	sending: InvitationSending,
): Promise<CreatedInvitation> {
	const { organisation, standing } = await managingChange(database, actor, organizationId);
	const address = invitedAddress(email);
	if (!address) throw new KeeprRefusal(400, 'INVALID_EMAIL', 'Enter an email address.');
	if (!isOrganisationRole(role))
		throw new KeeprRefusal(400, 'ORGANISATION_ROLE_NOT_KNOWN', `No Organisation role is ${role}.`);
	if (role === 'owner' && standing === 'admin') throw ownerRequired();
	// Inviting again replaces the address's offer: an admin may not replace an owner's.
	if (standing === 'admin' && (await pendingOwnerOffer(database, organizationId, address)))
		throw ownerRequired();
	await refuseOverHourlyCap(database, organizationId, actor.userId);
	let offered: AppRoles;
	try {
		offered = offeredAppRoles(appRoles);
	} catch (error) {
		throw refusalFromAuth(error);
	}
	const [member] = await database
		.select({ id: schema.member.id })
		.from(schema.member)
		.innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
		.where(and(eq(schema.member.organizationId, organizationId), eq(schema.user.email, address)));
	if (member) throw new KeeprRefusal(409, 'ALREADY_A_MEMBER', 'That address is already a member.');
	const [{ pending } = { pending: 0 }] = await database
		.select({ pending: count() })
		.from(schema.invitation)
		.where(
			and(
				eq(schema.invitation.organizationId, organizationId),
				eq(schema.invitation.status, 'pending'),
				gt(schema.invitation.expiresAt, new Date()),
				// The address's own is replaced, so it leaves room for the new one.
				ne(schema.invitation.email, address),
			),
		);
	if (pending >= INVITATION_LIMIT)
		throw new KeeprRefusal(
			403,
			'INVITATION_LIMIT_REACHED',
			`An Organisation has at most ${INVITATION_LIMIT} pending invitations.`,
		);
	return await issueInvitation(
		database,
		{
			organisation,
			email: address,
			role,
			appRoles: offered,
			inviterId: actor.userId,
			as: standing,
		},
		sending,
	);
}

/** Whether `address` holds a pending, unexpired offer to be an owner of `organizationId`. */
async function pendingOwnerOffer(
	database: IdentityDatabase,
	organizationId: string,
	address: string,
): Promise<boolean> {
	const [offer] = await database
		.select({ id: schema.invitation.id })
		.from(schema.invitation)
		.where(
			and(
				eq(schema.invitation.organizationId, organizationId),
				eq(schema.invitation.email, address),
				eq(schema.invitation.status, 'pending'),
				eq(schema.invitation.role, 'owner'),
				gt(schema.invitation.expiresAt, new Date()),
			),
		);
	return offer !== undefined;
}

/**
 * Refuses 429 an inviter who has made `INVITATIONS_PER_INVITER_PER_HOUR`
 * Invitations to the Organisation in the last hour, whatever became of them.
 */
async function refuseOverHourlyCap(
	database: IdentityDatabase,
	organizationId: string,
	inviterId: string,
): Promise<void> {
	const [{ made } = { made: 0 }] = await database
		.select({ made: count() })
		.from(schema.invitation)
		.where(
			and(
				eq(schema.invitation.organizationId, organizationId),
				eq(schema.invitation.inviterId, inviterId),
				gt(schema.invitation.createdAt, new Date(Date.now() - HOUR_MS)),
			),
		);
	if (made >= INVITATIONS_PER_INVITER_PER_HOUR)
		throw new KeeprRefusal(
			429,
			'TOO_MANY_INVITATIONS',
			`One person makes at most ${INVITATIONS_PER_INVITER_PER_HOUR} invitations to an Organisation an hour. Try again later.`,
		);
}

const HOUR_MS = 60 * 60 * 1000;

/** An Invitation still open to accept, as those who manage its Organisation see it. */
export interface PendingInvitation {
	id: string;
	email: string;
	role: string;
	appRoles: AppRoles;
	inviterName: string;
	expiresAt: string;
}

/**
 * The Organisation's pending, unexpired Invitations, soonest to lapse first. An
 * admin is not shown an offer to an owner, which only an owner makes.
 */
export async function listPendingInvitations(
	database: IdentityDatabase,
	actor: Actor,
	organizationId: string,
): Promise<PendingInvitation[]> {
	const { standing } = await managingStanding(database, actor, organizationId);
	const rows = await database
		.select({
			id: schema.invitation.id,
			email: schema.invitation.email,
			role: schema.invitation.role,
			appRoles: schema.invitation.appRoles,
			inviterName: schema.user.name,
			expiresAt: schema.invitation.expiresAt,
		})
		.from(schema.invitation)
		.leftJoin(schema.user, eq(schema.user.id, schema.invitation.inviterId))
		.where(
			and(
				eq(schema.invitation.organizationId, organizationId),
				eq(schema.invitation.status, 'pending'),
				gt(schema.invitation.expiresAt, new Date()),
				standing === 'admin' ? ne(schema.invitation.role, 'owner') : undefined,
			),
		)
		.orderBy(asc(schema.invitation.expiresAt));
	return rows.map((row) => ({
		id: row.id,
		email: row.email,
		role: row.role ?? 'member',
		appRoles: readableAppRoles(row.appRoles),
		inviterName: row.inviterName ?? 'Someone',
		expiresAt: row.expiresAt.toISOString(),
	}));
}

/**
 * The App roles a stored Invitation offers, or none when they cannot be read:
 * one such Invitation must not close the listing of every other.
 */
function readableAppRoles(stored: string | null): AppRoles {
	try {
		return offeredAppRoles(stored);
	} catch {
		return {};
	}
}

/**
 * Cancels a pending Invitation of the Organisation. Only an owner or a Keepr
 * Administrator cancels an offer to an owner; anything but a pending one is
 * refused 400.
 */
export async function cancelInvitation(
	database: IdentityDatabase,
	actor: Actor,
	{ organizationId, invitationId }: { organizationId: string; invitationId: string },
): Promise<void> {
	const { standing } = await managingStanding(database, actor, organizationId);
	const [invitation] = await database
		.select({ email: schema.invitation.email, role: schema.invitation.role })
		.from(schema.invitation)
		.where(
			and(
				eq(schema.invitation.id, invitationId),
				eq(schema.invitation.organizationId, organizationId),
			),
		);
	if (!invitation)
		throw new KeeprRefusal(404, 'INVITATION_NOT_FOUND', 'There is no such invitation.');
	if (invitation.role === 'owner' && standing === 'admin') throw ownerRequired();
	const [cancelled] = await database
		.update(schema.invitation)
		.set({ status: 'canceled' })
		.where(and(eq(schema.invitation.id, invitationId), eq(schema.invitation.status, 'pending')))
		.returning({ id: schema.invitation.id });
	if (!cancelled)
		throw new KeeprRefusal(
			400,
			'INVITATION_NOT_PENDING',
			'Only a pending invitation can be cancelled.',
		);
	await recordAudit(database, {
		action: 'invitation.cancelled',
		actorUserId: actor.userId,
		organizationId,
		detail: { invitationId, email: invitation.email, as: standing },
	});
}
