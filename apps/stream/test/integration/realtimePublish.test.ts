import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eventRealtimeChannel, screenRealtimeChannel } from '../../shared/utils/realtimeChannels';
import { $fetch } from './client';

/**
 * The server publishes to its Event's object (ADR-0137). What each helper
 * publishes, and what it does when the object fails, is tested at its home,
 * `test/unit/server/utils/ably.test.ts`; this is what only a running server
 * shows: the RPC, on the dev server's real binding, reaching the object.
 *
 * No socket can attach yet (the port lets nobody in until #1315), so what is
 * read is the object's own count: the sequence it gives the next message on a
 * channel.
 */

let eventId: number;
let screenId: number;

/** How many messages `channel` has been sent, counting the marker that asks. */
async function sequenceOn(channel: string): Promise<number> {
	const { seq } = await $fetch<{ seq: number }>('/api/_test/realtime-sequence', {
		method: 'POST',
		body: { eventId, channel },
	});
	return seq;
}

beforeAll(async () => {
	const event = await $fetch<{ id: number }>('/api/events', {
		method: 'POST',
		body: { name: 'Realtime Publish Event', game: 'mtg', featureMatchOrientation: 'horizontal' },
	});
	eventId = event.id;
	const screen = await $fetch<{ id: number }>(`/api/events/${eventId}/screens`, {
		method: 'POST',
		body: { name: 'Programme', slug: 'realtime-publish-screen', currentMode: 'background' },
	});
	screenId = screen.id;
});

afterAll(async () => {
	try {
		await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
	} catch {}
});

describe("a write's publish", () => {
	it("reaches the Event's channel of the Event's object", async () => {
		const channel = eventRealtimeChannel(eventId);
		const before = await sequenceOn(channel);

		await $fetch(`/api/events/${eventId}`, { method: 'PATCH', body: { name: 'Renamed' } });

		// The write's one message, then the marker.
		expect(await sequenceOn(channel)).toBe(before + 2);
	});

	it("reaches a commanded Screen's channel of the same object, before the command answers", async () => {
		const channel = screenRealtimeChannel(eventId, screenId);
		const before = await sequenceOn(channel);

		await $fetch(`/api/events/${eventId}/screens/${screenId}/command`, {
			method: 'POST',
			body: { command: 'identify' },
		});

		expect(await sequenceOn(channel)).toBe(before + 2);
	});
});
