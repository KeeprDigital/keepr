import type { ScreenResponse } from '~~/shared/api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eventRealtimeChannel } from '../../shared/utils/realtimeChannels';
import { $fetch, anonymousFetch } from './client';
import { followAsOperator } from './realtimeFollower';

// A Deck List Screen showing an OP Slot side is released, and says so, when
// its Slot is deleted (ADR-0057). What it reads is in
// `featureMatchDeckScreen.test.ts`.

describe('a Deck List Screen showing a Feature Match Slot side, to its followers', () => {
	let eventId: number;
	let slotId: number;
	let screen: ScreenResponse;
	let capability: string;

	async function outputStatus(resource: string): Promise<number> {
		const response = await anonymousFetch(
			`/api/screen-output/events/${eventId}/screens/${screen.id}/${resource}`,
			{
				headers: { authorization: `Bearer ${capability}` },
			},
		);
		return response.status;
	}

	beforeAll(async () => {
		const event = await $fetch('/api/events', {
			method: 'POST',
			body: {
				name: 'Integration One Piece Deck List Screen Release',
				game: 'op',
				featureMatchOrientation: 'horizontal',
			},
		});
		eventId = event.id;
		const slot = await $fetch(`/api/events/${eventId}/feature-match-slots`, {
			method: 'POST',
			body: {
				player1Data: { name: 'Ana' },
				player2Data: { name: 'Ben' },
			},
		});
		slotId = slot.id;

		screen = await $fetch<ScreenResponse>(`/api/events/${eventId}/screens`, {
			method: 'POST',
			body: { name: 'Deck', slug: `op-deck-screen-release-${eventId}`, currentMode: 'deck' },
		});
		screen = await $fetch<ScreenResponse>(
			`/api/events/${eventId}/screens/${screen.id}/config/deck`,
			{
				method: 'PATCH',
				body: {
					deckSource: { type: 'featureMatchSlot', slotId, side: 'player1' },
				},
			},
		);
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

	// The delete clears the Screen's Deck Source in its own write, and announces the Screen.
	it('is released and announced when its Slot is deleted', async () => {
		const follower = await followAsOperator(eventId, eventRealtimeChannel(eventId), [
			'screen:updated',
		]);

		try {
			const before = await $fetch<ScreenResponse>(`/api/events/${eventId}/screens/${screen.id}`);
			await $fetch(`/api/events/${eventId}/feature-match-slots/${slotId}`, { method: 'DELETE' });

			await follower.hear('screen:updated', (data) => data?.screenId === screen.id);

			const released = await $fetch<ScreenResponse>(`/api/events/${eventId}/screens/${screen.id}`);
			expect(released.modeConfigs?.deck?.deckSource).toEqual({
				type: 'featureMatchSlot',
				slotId: null,
				side: 'player1',
			});
			expect(released.stateVersion).toBe(before.stateVersion + 1);
			expect(await outputStatus(`feature-match-slots/${slotId}`)).toBe(404);
		} finally {
			follower.stop();
		}
	});
});
