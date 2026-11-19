import type { ScreenResponse } from '~~/shared/api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { screenRealtimeChannel } from '../../shared/utils/realtimeChannels';
import { $fetch } from './client';
import { followAsScreenOutput } from './realtimeFollower';

/**
 * A Screen Output hears on its own Screen channel, holding only its Screen
 * Output Asset Capability, that what its mode shows changed (#604): a Realtime
 * Ticket for the capability lets its socket in, with no Session (ADR-0142). The
 * reads it then makes are in `screenOutputReads.test.ts`.
 */
describe('a capability-only Screen Output on its Screen channel', () => {
	let eventId: number;
	let screen: ScreenResponse;
	let capability: string;

	beforeAll(async () => {
		const event = await $fetch<{ id: number }>('/api/events', {
			method: 'POST',
			body: {
				name: 'Screen Output Channel Event',
				game: 'mtg',
				featureMatchOrientation: 'vertical',
			},
		});
		eventId = event.id;

		screen = await $fetch<ScreenResponse>(`/api/events/${eventId}/screens`, {
			method: 'POST',
			body: {
				name: 'Output standings',
				slug: `output-channel-standings-${eventId}`,
				currentMode: 'standings',
			},
		});
		capability = (
			await $fetch<{ assetCapability: string }>(
				`/api/events/${eventId}/screens/${screen.id}/asset-capability`,
			)
		).assetCapability;
	});

	afterAll(async () => {
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		} catch {}
	});

	// The Screen's own channel names what its mode shows changed; the output re-reads it through its Screen.
	it("is told on its own channel that its mode's data changed", async () => {
		const output = await followAsScreenOutput(
			eventId,
			capability,
			screenRealtimeChannel(eventId, screen.id),
			['output:modeDataChanged'],
		);

		try {
			await $fetch(`/api/events/${eventId}/players`, {
				method: 'POST',
				body: { name: 'Heard On The Screen Channel' },
			});

			expect(await output.hear('output:modeDataChanged')).toMatchObject({
				eventId,
				screenId: screen.id,
				causes: ['player'],
			});
		} finally {
			output.stop();
		}
	});
});
