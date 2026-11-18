// Throwaway for #1295: can an ordinary route hand back the object's 101?
export default defineEventHandler(async (event) => {
	const { env, request } = event.context.cloudflare;
	const { event: eventId } = getQuery(event);
	return env.EVENT_REALTIME.getByName(`event:${eventId}`).fetch(request);
});
