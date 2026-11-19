/**
 * Where a page opens an Event's socket, on the app's own host (ADR-0137). One
 * constant for both ends: `nuxt.config.ts` gives it to the realtime layer as
 * its `socketPath`, and a page's transport builds its address from it
 * (`app/plugins/realtime.client.ts`).
 */
export const REALTIME_SOCKET_PATH = '/realtime/socket';

/**
 * The realtime scope of an Event (ADR-0137): the name of the one object that
 * holds every socket of the Event and orders every message on its channels,
 * the Event's own and each of its Screens'. The server publishes to it, and
 * the port names it for each socket it lets in.
 */
export function eventRealtimeScope(eventId: number): string {
	return `event:${eventId}`;
}

export function eventRealtimeChannel(eventId: number): string {
	return `event:${eventId}`;
}

export function screenRealtimeChannel(eventId: number, screenId: number): string {
	return `screen:${eventId}:${screenId}`;
}

/** Wildcard capability pattern covering every Screen channel of one Event. */
export function screenChannelWildcard(eventId: number): string {
	return `screen:${eventId}:*`;
}

/**
 * The realtime identity a Screen Output connects as (#397).
 *
 * Here rather than in the route that grants it, because this file owns how
 * realtime names things. Legible on purpose: it is the identity, and the tag, a
 * Screen Output's sockets are known by, where "which Screen is this" is the only
 * question anybody asks of it.
 *
 * A signed-in operator connects as their User id instead, which needs no helper:
 * Keepr Accounts already owns that name.
 */
export function screenOutputRealtimeClientId(screenId: number): string {
	return `screen-output:${screenId}`;
}

/**
 * The tag a Screen Output's socket also carries: which of its Screen's
 * capabilities let it in, by that capability's version. Regenerating the
 * capability closes the Screen's sockets and spares the ones that carry the new
 * version's (`server/modules/screen-output-assets/runtime.ts`).
 */
export function screenOutputCapabilityRealtimeTag(screenId: number, version: number): string {
	return `${screenOutputRealtimeClientId(screenId)}:capability:${version}`;
}

/**
 * The Event a realtime channel belongs to, or null for unrecognized shapes.
 * Every channel built above encodes its Event; the transport uses this to
 * find the Event's socket without callers passing the Event separately.
 */
export function realtimeChannelEventId(channel: string): number | null {
	const match = /^(?:event|screen):(\d+)(?::|$)/.exec(channel);
	return match ? Number(match[1]) : null;
}
