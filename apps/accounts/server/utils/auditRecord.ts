import type { IdentityDatabase } from '~~/server/db';
import { is, SQL, sql } from 'drizzle-orm';
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
	| 'user.enabled'
	/** A Keepr Administrator made another User one (ADR-0156). */
	| 'user.keepr-administrator-granted';

export interface AuditEntry {
	action: AuditAction;
	/** The User who acted; none for the command that writes a First Administrator Claim. */
	actorUserId: string | null;
	organizationId?: string | null;
	/** The User the action was done to, once there is one. */
	subjectUserId?: string | null;
	/** What else the action needs to be understood: an object, or SQL that answers its JSON. */
	detail?: Record<string, unknown> | SQL;
}

function detailOf(detail: AuditEntry['detail']): string | SQL | null {
	if (detail === undefined) return null;
	return is(detail, SQL) ? detail : JSON.stringify(detail);
}

/**
 * One row of the Audit Record, stamped now, as a statement not yet run: a write
 * puts it in the same batch as the change it records, so neither is written
 * without the other. Rows are only ever added.
 */
export function auditRow(database: IdentityDatabase, entry: AuditEntry) {
	return database.insert(schema.auditRecord).values({
		id: crypto.randomUUID(),
		at: new Date(),
		action: entry.action,
		actorUserId: entry.actorUserId,
		organizationId: entry.organizationId ?? null,
		subjectUserId: entry.subjectUserId ?? null,
		detail: detailOf(entry.detail),
	});
}

/**
 * One row of the Audit Record for each row `from` holds where `where` is true, or
 * one row when `where` is true and there is no `from`: for a change whose batch
 * learns only as it runs whether it happened, or what it touched. `detail` may
 * read the row.
 */
export function auditRowsWhere(
	database: IdentityDatabase,
	entry: Omit<AuditEntry, 'detail' | 'organizationId'> & {
		/** The Organisation, or SQL that reads it from the row. */
		organizationId?: string | null | SQL;
		detail: SQL;
		from?: SQL;
		where: SQL;
	},
) {
	// In the table's column order: id, at, actor, action, Organisation, subject, detail.
	return database
		.insert(schema.auditRecord)
		.select(
			sql`select lower(hex(randomblob(16))), ${Date.now()}, ${entry.actorUserId}, ${entry.action}, ${entry.organizationId ?? null}, ${entry.subjectUserId ?? null}, ${entry.detail}${entry.from === undefined ? sql`` : sql` from ${entry.from}`} where ${entry.where}`,
		);
}

/** Adds one row to the Audit Record, stamped now, on its own. */
export async function recordAudit(database: IdentityDatabase, entry: AuditEntry): Promise<void> {
	await auditRow(database, entry);
}
