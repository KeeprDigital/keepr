import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eventRealtimeChannel } from '../../shared/utils/realtimeChannels';
import { $fetch } from './client';
import { followAsOperator } from './realtimeFollower';

// What the Talent routes announce, as an Operator's page hears it. The routes themselves are in `talents.test.ts`.

describe('talents API announcements', () => {
	let eventId: number;

	beforeAll(async () => {
		const event = await $fetch('/api/events', {
			method: 'POST',
			body: {
				name: 'Integration Talent Announcements Event',
				game: 'mtg',
				featureMatchOrientation: 'horizontal',
			},
		});
		eventId = event.id;
	});

	afterAll(async () => {
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		} catch {}
	});

	it('publishes normalized complete Social Profile maps from the Talent routes', async () => {
		const follower = await followAsOperator(eventId, eventRealtimeChannel(eventId), [
			'talent:created',
			'talent:updated',
		]);
		/** The named message about this Talent, whether it arrived before the request answered or arrives after. */
		const announced = async (name: string, talentId: number) =>
			await follower.hear(name, (data) => data?.talent?.id === talentId);

		try {
			const created = await $fetch(`/api/events/${eventId}/talents`, {
				method: 'POST',
				body: {
					name: 'Realtime Route Caster',
					socialProfiles: {
						twitch: 'https://twitch.tv/@RouteCaster',
						youtube: 'https://youtube.com/@RouteCasts',
					},
				},
			});
			expect(await announced('talent:created', created.id)).toMatchObject({
				eventId,
				talent: {
					id: created.id,
					name: 'Realtime Route Caster',
					socialProfiles: { twitch: 'RouteCaster', youtube: 'RouteCasts' },
				},
			});

			await $fetch(`/api/events/${eventId}/talents/${created.id}`, {
				method: 'PATCH',
				body: {
					socialProfiles: {
						x: 'https://x.com/@RouteCaster',
						bluesky: 'https://bsky.app/profile/@RouteCaster.bsky.social',
					},
				},
			});
			expect(await announced('talent:updated', created.id)).toMatchObject({
				eventId,
				talent: {
					id: created.id,
					name: 'Realtime Route Caster',
					socialProfiles: { x: 'RouteCaster', bluesky: 'RouteCaster.bsky.social' },
				},
			});
		} finally {
			follower.stop();
		}
	});
});
