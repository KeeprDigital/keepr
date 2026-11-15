import { eq, sql } from 'drizzle-orm';
import { db } from '~~/server/db';
import { eventOpCardNumberResolutions } from '~~/server/db/schema';

/**
 * Storage of a One Piece Card Game Event's resolved Unresolved Deck Cards
 * (ADR-0074): each card number an operator resolved, and the card number it
 * names, one per number in the Event, a later resolution replacing it.
 */
export function opCardNumberResolutionService() {
	/** The Event's resolutions, the card number each resolved number names. */
	async function findByEvent(eventId: number): Promise<Map<string, string>> {
		const rows = await db.select({
			cardNumber: eventOpCardNumberResolutions.cardNumber,
			resolvedCardNumber: eventOpCardNumberResolutions.resolvedCardNumber,
		})
			.from(eventOpCardNumberResolutions)
			.where(eq(eventOpCardNumberResolutions.eventId, eventId));
		return new Map(rows.map(row => [row.cardNumber, row.resolvedCardNumber]));
	}

	async function record({ eventId, cardNumber, resolvedCardNumber }: { eventId: number; cardNumber: string; resolvedCardNumber: string }): Promise<void> {
		await db.insert(eventOpCardNumberResolutions)
			.values({ eventId, cardNumber, resolvedCardNumber })
			.onConflictDoUpdate({
				target: [eventOpCardNumberResolutions.eventId, eventOpCardNumberResolutions.cardNumber],
				set: { resolvedCardNumber, updatedAt: sql`(unixepoch() * 1000)` },
			});
	}

	return { findByEvent, record };
}
