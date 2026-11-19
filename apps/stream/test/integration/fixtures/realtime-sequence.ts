import { z } from 'zod';
import { eventRealtimeScope } from '~~/shared/utils/realtimeChannels';

const markerSchema = z.object({ eventId: z.number().int(), channel: z.string().min(1) });

/**
 * Publishes a marker on one channel of an Event's object and answers the
 * sequence the object gave it: how many messages that channel has been sent,
 * the marker included. The object answers nothing else of a channel to a
 * caller with no socket.
 */
export default defineEventHandler(async (event) => {
	const { eventId, channel } = await readValidatedBody(event, markerSchema.parse);
	const [answer] = await useRealtimeScope(event, eventRealtimeScope(eventId)).publish([
		{ channel, name: 'test:marker', data: null },
	]);
	return answer;
});
