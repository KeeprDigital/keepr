import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '~~/server/db';
import { requireGraphicsAdministrator } from '~~/server/modules/graphics-administrator';
import { disconnectDeletedEvent, publishMessage } from '~~/server/utils/realtimePublish';

/** How many Events one call ends: each costs two calls to its object. */
const MAX_EVENTS_PER_CALL = 200;

const rangeSchema = z
	.object({
		from: z.number().int().positive().optional(),
		through: z.number().int().positive().optional(),
	})
	.strict();

/** The highest Event id the database has issued, deleted or not: `AUTOINCREMENT` keeps it. */
async function highestEventIdIssued(): Promise<number> {
	const [row] = await db.all<{ seq: number }>(
		sql`SELECT seq FROM sqlite_sequence WHERE name = 'events'`,
	);
	return row?.seq ?? 0;
}

/**
 * `POST /api/admin/realtime/end-events`: end the realtime of every Event id in
 * a range, as deleting each Event does (ADR-0146), whether or not its row
 * still exists. Each object is sent `event:deleted`, which an operator's page
 * leaves on, and then closes every socket (ADR-0162).
 *
 * For the data wipe and the restore (`README.md` § Database): either hands an
 * Event id the database issued before to a new row, and a socket still open on
 * that id's object would hear the new row's channels. So it is run before the
 * wipe or the restore, while the database still knows the highest id it issued.
 *
 * With no `through`, through that highest id; at most 200 a call. `failed`
 * names each Event whose sockets could not be closed: run it again for them.
 */
export default defineEventHandler(async (event) => {
	await requireGraphicsAdministrator(event);
	const range = await readValidatedBody(event, rangeSchema.parse);
	const highestEventId = await highestEventIdIssued();
	const from = range.from ?? 1;
	const through = range.through ?? highestEventId;
	if (from > through || through - from + 1 > MAX_EVENTS_PER_CALL) {
		throw createError({
			statusCode: 400,
			statusMessage: 'Bad Request',
			message: `Name a range of 1 to ${MAX_EVENTS_PER_CALL} Events with from and through, the highest issued being ${highestEventId}`,
		});
	}

	// Each failure is logged by the call that met it; the answer names the
	// Events whose sockets may still be open, to be ended again before the wipe.
	const failed: number[] = [];
	for (let eventId = from; eventId <= through; eventId += 1) {
		await publishMessage(eventId, 'event:deleted', { eventId });
		if (!(await disconnectDeletedEvent(eventId))) failed.push(eventId);
	}
	return { from, through, highestEventId, failed };
});
