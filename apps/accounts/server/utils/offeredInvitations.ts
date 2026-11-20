import type { IdentityDatabase } from '~~/server/db';
import type { ManagingStanding } from './memberManagement';
import type { SQL } from 'drizzle-orm';
import { and, eq, sql } from 'drizzle-orm';
import { schema } from '~~/server/db';
import { auditRowsWhere } from './auditRecord';

/** Why the Invitations someone offered are cancelled with them. */
export type InviterGone = 'inviter-removed' | 'inviter-disabled';

/**
 * The statements that cancel the pending Invitations `inviterId` offered, in
 * `organizationId` or, without one, in every Organisation, for the batch of the
 * change that ends the inviter's standing: an offer stands no longer than it.
 * Each is a cancellation in the Audit Record naming who cancelled it, as what,
 * and why, recorded before it is cancelled.
 */
export function offeredInvitationCancellations(
	database: IdentityDatabase,
	{ inviterId, organizationId }: { inviterId: string; organizationId?: string },
	{ actorUserId, as, because }: { actorUserId: string; as: ManagingStanding; because: InviterGone },
	/** Whether the change that ends their standing was made, read as the batch runs. */
	onlyIf?: SQL,
) {
	const { invitation } = schema;
	const offered = and(
		eq(invitation.inviterId, inviterId),
		eq(invitation.status, 'pending'),
		organizationId === undefined ? undefined : eq(invitation.organizationId, organizationId),
		onlyIf,
	)!;
	return [
		auditRowsWhere(database, {
			action: 'invitation.cancelled',
			actorUserId,
			organizationId: sql`${invitation.organizationId}`,
			detail: sql`json_object('invitationId', ${invitation.id}, 'email', ${invitation.email}, 'as', ${as}, 'because', ${because})`,
			from: sql`${invitation}`,
			where: offered,
		}),
		database.update(invitation).set({ status: 'canceled' }).where(offered),
	] as const;
}
