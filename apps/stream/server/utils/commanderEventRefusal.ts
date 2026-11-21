import { eq } from 'drizzle-orm';
import { db } from '~~/server/db';
import { events } from '~~/server/db/schema';
import { eventKind } from '~~/shared/config/games';

/**
 * Refuses a write of something a Commander Event does not have: it is produced
 * from its Feature Match Slots alone, with no Players, Player Lists, Rounds,
 * Matches, Feature Match Assignments or Archetypes (ADR-0087). Each write
 * module asks it, so no route or caller can reach round it.
 */
export async function refuseOnCommanderEvent(eventId: number, what: string): Promise<void> {
	const event = await db.query.events.findFirst({
		where: eq(events.id, eventId),
		columns: { game: true, variant: true },
	});
	if (event && eventKind(event) === 'mtg-commander')
		throw createError({
			statusCode: 400,
			statusMessage: `A Commander Event has no ${what}`,
		});
}
