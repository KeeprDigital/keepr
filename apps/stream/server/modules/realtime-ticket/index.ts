/**
 * The Realtime Ticket (ADR-0137, ADR-0142): what a Screen Output is given for
 * its Screen Output Asset Capability, and spends to open one realtime socket.
 * A browser cannot put `Authorization` on a WebSocket, so the capability stays
 * on the HTTP route that already takes it and the socket carries this instead.
 *
 * Both rules are a statement each, so neither has a moment between its check
 * and its write:
 *
 * - **Giving** inserts a row only where the capability is a Screen's and that
 *   Screen is in the Event asked for.
 * - **Spending** deletes the row as it reads it. Two sockets that present one
 *   ticket at once run that statement one after the other, and the second
 *   finds no row.
 */

/** How long a ticket admits: the time between asking for it and opening the socket, and no more. */
export const REALTIME_TICKET_LIFETIME_MS = 30_000;

/** A ticket as it is given: 32 random bytes, base64url. Anything else was never one. */
const REALTIME_TICKET_PATTERN = /^[\w-]{43}$/;

function newTicket(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/** What is stored of a ticket: enough to recognise it, and nothing that could be presented. */
async function ticketDigest(ticket: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ticket));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export interface GivenRealtimeTicket {
	ticket: string;
	expiresAt: Date;
}

export function createD1RealtimeTickets(database: D1Database, now: () => number = Date.now) {
	return {
		/**
		 * A ticket for the Screen `capabilityDigest` is the capability of, or
		 * `null`: when it is no Screen's, and when its Screen is not in `eventId`.
		 * One answer for both, so nothing says which.
		 *
		 * Every ticket given first deletes the ones that expired unspent, so the
		 * table holds what was given in the last `REALTIME_TICKET_LIFETIME_MS`
		 * and no sweep is scheduled for it.
		 */
		async give(input: {
			capabilityDigest: string;
			eventId: number;
		}): Promise<GivenRealtimeTicket | null> {
			const ticket = newTicket();
			const at = now();
			const expiresAt = at + REALTIME_TICKET_LIFETIME_MS;
			const [, given] = await database.batch([
				database.prepare('DELETE FROM realtime_tickets WHERE expires_at <= ?').bind(at),
				database
					.prepare(`
					INSERT INTO realtime_tickets
						(ticket_digest, event_id, screen_id, capability_digest, expires_at)
					SELECT ?, screen.event_id, screen.id, screen.asset_capability_digest, ?
					FROM screens screen
					WHERE screen.asset_capability_digest = ? AND screen.event_id = ?
				`)
					.bind(await ticketDigest(ticket), expiresAt, input.capabilityDigest, input.eventId),
			]);
			if (given?.meta.changes !== 1) return null;
			return { ticket, expiresAt: new Date(expiresAt) };
		},

		/**
		 * Spend `ticket` on a socket of `eventId`: the Screen it was given for, or
		 * `null`. It admits when it is unexpired, was given for this Event, and
		 * the capability it was given for is still its Screen's.
		 *
		 * A ticket presented is spent whatever the answer: the row is deleted by
		 * the statement that reads it, and that statement reads everything the
		 * answer depends on, the Screen's capability included, at one moment.
		 */
		async spend(input: { ticket: string; eventId: number }): Promise<{ screenId: number } | null> {
			if (!REALTIME_TICKET_PATTERN.test(input.ticket)) return null;
			const spent = await database
				.prepare(`
				DELETE FROM realtime_tickets
				WHERE ticket_digest = ?
				RETURNING
					event_id AS eventId,
					screen_id AS screenId,
					expires_at AS expiresAt,
					EXISTS (
						SELECT 1 FROM screens screen
						WHERE screen.id = realtime_tickets.screen_id
							AND screen.event_id = realtime_tickets.event_id
							AND screen.asset_capability_digest = realtime_tickets.capability_digest
					) AS capabilityIsCurrent
			`)
				.bind(await ticketDigest(input.ticket))
				.all<{
					eventId: number;
					screenId: number;
					expiresAt: number;
					capabilityIsCurrent: number;
				}>();
			const [row] = spent.results;
			if (!row) return null;
			if (row.eventId !== input.eventId) return null;
			if (row.expiresAt <= now()) return null;
			if (row.capabilityIsCurrent !== 1) return null;
			return { screenId: row.screenId };
		},
	};
}

export type RealtimeTickets = ReturnType<typeof createD1RealtimeTickets>;
