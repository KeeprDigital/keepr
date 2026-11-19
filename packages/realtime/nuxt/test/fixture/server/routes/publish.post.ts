import type { Delivery } from '../../../../../src/object/index.ts';

/** Publishes the deliveries in the body to a room, as an app's write does. */
export default defineEventHandler(async (event) => {
	const { room } = getQuery(event);
	if (typeof room !== 'string') throw createError({ statusCode: 400 });
	return useRealtimeScope(event, `room:${room}`).publish(await readBody<Delivery[]>(event));
});
