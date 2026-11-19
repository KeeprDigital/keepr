import type { Delivery } from '@keepr/realtime/object';
import { eventRealtimeScope } from '../../../shared/utils/realtimeChannels';

/**
 * Publishes the body's deliveries to an Event's realtime object, as a write
 * of the app's own does. Registered only for the integration suite
 * (`nuxt.config.ts`), behind the Session boundary like every `/api/**` route.
 */
export default defineEventHandler(async (event) => {
	const { eventId, deliveries } = await readBody<{ eventId: number; deliveries: Delivery[] }>(
		event,
	);
	return await useRealtimeScope(event, eventRealtimeScope(eventId)).publish(deliveries);
});
