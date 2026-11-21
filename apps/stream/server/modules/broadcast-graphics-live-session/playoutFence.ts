import type { SQL } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { SQLiteAsyncDialect } from 'drizzle-orm/sqlite-core';
import { db } from '~~/server/db';

/**
 * The Broadcast Graphics Live Session a Screen write read what is on air from.
 *
 * A stack write is refused when it edits a graphic on air (ADR-0081), and that
 * answer is read before the write commits. A Take committing in between would
 * put the edit on program unreviewed, so the write carries this fence and
 * commits only while the Screen's playout is still the one it read: the same
 * epoch at the same sequence, or, when it read none, no epoch that has accepted
 * anything.
 */
export interface BroadcastGraphicsPlayoutFence {
	screenId: number;
	/** The epoch read, or null when the Screen had none. */
	sessionId: number | null;
	sequence: number;
}

/**
 * True while no active epoch of the Screen has accepted a command since the read.
 * An epoch at sequence 0 has accepted nothing, so has nothing on air.
 */
export function broadcastGraphicsPlayoutFenceCondition(fence: BroadcastGraphicsPlayoutFence): SQL {
	return sql`NOT EXISTS (
		SELECT 1 FROM broadcast_graphics_live_sessions
		WHERE screen_id = ${fence.screenId}
			AND status = 'active'
			AND sequence > 0
			AND NOT (id IS ${fence.sessionId} AND sequence = ${fence.sequence})
	)`;
}

const fenceDialect = new SQLiteAsyncDialect();

/** `broadcastGraphicsPlayoutFenceCondition` for a raw prepared statement. */
export function broadcastGraphicsPlayoutFenceClause(fence: BroadcastGraphicsPlayoutFence): {
	sql: string;
	params: unknown[];
} {
	return fenceDialect.sqlToQuery(broadcastGraphicsPlayoutFenceCondition(fence));
}

/** Whether playout has moved past the fence since it was read. */
export async function broadcastGraphicsPlayoutFenceRefused(
	fence: BroadcastGraphicsPlayoutFence,
): Promise<boolean> {
	const clause = broadcastGraphicsPlayoutFenceClause(fence);
	const row = await db.$client
		.prepare(`SELECT ${clause.sql} AS held`)
		.bind(...clause.params)
		.first<{ held: number }>();
	return row?.held !== 1;
}

/** The refusal a fenced write answers when playout moved under it. */
export function broadcastGraphicsPlayoutMovedConflict() {
	return createError({
		statusCode: 409,
		statusMessage: 'Conflict',
		message:
			'Broadcast Graphics playout changed while this Screen was being saved. Reload it, then save again.',
	});
}
