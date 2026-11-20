/**
 * Withdraws a tag in a room, as an app does when a credential is withdrawn, or
 * everyone in it with `all`, as when the room itself has ended.
 */
export default defineEventHandler(async (event) => {
	const { room, tag, all } = getQuery(event);
	if (typeof room !== 'string') throw createError({ statusCode: 400 });
	const scope = useRealtimeScope(event, `room:${room}`);
	if (all !== undefined) return scope.disconnectAll();
	if (typeof tag !== 'string') throw createError({ statusCode: 400 });
	return scope.disconnect(tag);
});
