import { TICKET_HEADER } from '../../../../../../src/object/handOff.ts';
import { HAND_OFF_HEADER } from '../../../../../server/worker/headers.ts';

/**
 * The fixture's port. A caller is whoever its `caller` cookie says, and joins
 * the room its query names, where it may hear that room's channels; its socket
 * is tagged with who it is. A caller with no cookie is refused, and so is a
 * page on another origin, as a Session boundary refuses one. The room `broken`
 * fails, as an app's own fault would, and the room `unauthorized` is refused by
 * status, as an app's middleware would. A room named `cf-…` admits only a
 * question that carries the caller's Cloudflare properties. Under `nuxt dev`
 * the hand-off's own header is on every question, by design.
 */
export default defineRealtimePort((event) => {
	// The question carries nothing from the caller that the hand-off itself reads.
	// A port that saw one fails, which a test can tell from being let in.
	if (getRequestHeader(event, TICKET_HEADER) !== undefined) throw createError({ statusCode: 500 });
	if (!import.meta.dev && getRequestHeader(event, HAND_OFF_HEADER) !== undefined)
		throw createError({ statusCode: 500 });
	const caller = getCookie(event, 'caller');
	const { room } = getQuery(event);
	if (room === 'broken') throw createError({ statusCode: 503 });
	if (room === 'unauthorized') throw createError({ statusCode: 401 });
	if (!caller || typeof room !== 'string') return null;
	const origin = getRequestHeader(event, 'origin');
	if (origin !== undefined && new URL(origin).host !== getRequestURL(event).host) return null;
	const request = (event.context.cloudflare as { request?: { cf?: unknown } } | undefined)?.request;
	if (room.startsWith('cf-') && typeof request?.cf !== 'object') return null;
	return {
		scope: `room:${room}`,
		grant: { identity: caller, hear: [`room:${room}:*`], tags: [`caller:${caller}`] },
	};
});
