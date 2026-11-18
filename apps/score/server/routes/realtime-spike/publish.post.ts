// Throwaway for #1295: a route publishing by RPC on the Worker's own binding.
export default defineEventHandler(async (event) => {
	const { env } = event.context.cloudflare;
	const { event: eventId } = getQuery(event);
	return env.EVENT_REALTIME.getByName(`event:${eventId}`).publish(await readBody(event));
});
