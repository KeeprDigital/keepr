import type { IdentityDatabase } from '~~/server/db';
import { schema } from '~~/server/db';

/**
 * What the Audit Record names each administrative action (#1228 § Administration
 * and audit). The name is stored, so one is never renamed.
 */
export type AuditAction =
	| 'first-administrator-claim.made'
	| 'first-administrator-claim.consumed'
	| 'organisation.created'
	| 'invitation.created'
	| 'invitation.accepted'
	| 'invitation.cancelled'
	| 'invitation.declined'
	| 'member.role-changed'
	| 'member.removed'
	| 'app-access.set'
	| 'app-access.removed'
	| 'user.disabled'
	/** A Keepr Administrator ended a User's Sessions, as disabling them does. */
	| 'user.sessions-ended'
	| 'user.enabled';

export interface AuditEntry {
	action: AuditAction;
	/** The User who acted; none for the command that writes a First Administrator Claim. */
	actorUserId: string | null;
	organizationId?: string | null;
	/** The User the action was done to, once there is one. */
	subjectUserId?: string | null;
	/** What else the action needs to be understood. */
	detail?: Record<string, unknown>;
}

/** Adds one row to the Audit Record, stamped now. Rows are only ever added. */
export async function recordAudit(database: IdentityDatabase, entry: AuditEntry): Promise<void> {
	await database.insert(schema.auditRecord).values({
		id: crypto.randomUUID(),
		at: new Date(),
		action: entry.action,
		actorUserId: entry.actorUserId,
		organizationId: entry.organizationId ?? null,
		subjectUserId: entry.subjectUserId ?? null,
		detail: entry.detail === undefined ? null : JSON.stringify(entry.detail),
	});
}
