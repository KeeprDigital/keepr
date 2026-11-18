// Throwaway for #1295: stands in for the Session or capability check.
export default defineEventHandler((event) => {
	if (getRequestHeader(event, 'cookie') !== 'spike=allowed')
		throw createError({ statusCode: 401, message: 'No session' });
	const { event: eventId } = getQuery(event);
	return { scope: `event:${eventId}` };
});
