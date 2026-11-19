/**
 * The fixture's port. A caller is whoever its `caller` cookie says, and joins
 * the room its query names, where it may hear that room's channels. A caller
 * with no cookie is refused, and so is a page on another origin, as a Session
 * boundary refuses one. The room `broken` fails, as an app's own fault would.
 */
export default defineRealtimePort((event) => {
	const caller = getCookie(event, 'caller');
	const { room } = getQuery(event);
	if (room === 'broken') throw createError({ statusCode: 503 });
	if (!caller || typeof room !== 'string') return null;
	const origin = getRequestHeader(event, 'origin');
	if (origin !== undefined && new URL(origin).host !== getRequestURL(event).host) return null;
	return { scope: `room:${room}`, grant: { identity: caller, hear: [`room:${room}:*`] } };
});
