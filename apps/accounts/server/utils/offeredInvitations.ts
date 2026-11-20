import type { IdentityDatabase } from '~~/server/db';
import type { ManagingStanding } from './memberManagement';
import { and, eq } from 'drizzle-orm';
import { schema } from '~~/server/db';
import { recordAudit } from './auditRecord';

/** Why the Invitations someone offered are cancelled with them. */
export type InviterGone = 'inviter-removed' | 'inviter-disabled';

/**
 * Cancels the pending Invitations `inviterId` offered, in `organizationId` or,
 * without one, in every Organisation, each a cancellation in the Audit Record
 * naming who cancelled it, as what, and why: an offer stands no longer than its
 * inviter's standing.
 */
export async function cancelInvitationsOfferedBy(
	database: IdentityDatabase,
	{ inviterId, organizationId }: { inviterId: string; organizationId?: string },
	{ actorUserId, as, because }: { actorUserId: string; as: ManagingStanding; because: InviterGone },
): Promise<void> {
	const cancelled = await database
		.update(schema.invitation)
		.set({ status: 'canceled' })
		.where(
			and(
				eq(schema.invitation.inviterId, inviterId),
				eq(schema.invitation.status, 'pending'),
				organizationId === undefined
					? undefined
					: eq(schema.invitation.organizationId, organizationId),
			),
		)
		.returning({
			id: schema.invitation.id,
			organizationId: schema.invitation.organizationId,
			email: schema.invitation.email,
		});
	for (const invitation of cancelled)
		await recordAudit(database, {
			action: 'invitation.cancelled',
			actorUserId,
			organizationId: invitation.organizationId,
			detail: { invitationId: invitation.id, email: invitation.email, as, because },
		});
}
