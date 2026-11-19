import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eventRealtimeChannel } from '../../shared/utils/realtimeChannels';
import { $fetch } from './client';
import { followAsOperator } from './realtimeFollower';

// A Feature Match Deck List pasted on a One Piece Slot side (ADR-0057): a
// replacement during a Session reaches its followers. What it stores is in
// `featureMatchDeckList.test.ts`. bandai-keepr is
// `./mock-bandai-keepr.mjs`.

const ZORO_DECK = '1x OP01-001 Roronoa Zoro\n4x OP01-025\n2x OP99-999';
const NAMI_DECK = '1x OP01-016 Nami\n4x OP01-040';

describe("a Feature Match Slot side's Deck List, to its followers", () => {
	let eventId: number;
	let slotId: number;
	let sessionId: number;

	beforeAll(async () => {
		const event = await $fetch('/api/events', {
			method: 'POST',
			body: {
				name: 'Integration One Piece Deck Lists',
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
		const session = await $fetch(`/api/events/${eventId}/feature-match-slots/${slotId}/sessions`, {
			method: 'POST',
		});
		sessionId = session.id;
		// The side holds a Deck List mid-Session, so the paste below replaces one.
		await paste(NAMI_DECK);
	});

	afterAll(async () => {
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		} catch {}
	});

	async function paste(text: string) {
		return (await $fetch(`/api/events/${eventId}/feature-match-slots/${slotId}/deck-lists`, {
			method: 'POST',
			body: { side: 'player1', text },
		})) as any;
	}

	// The Slot's own announcement carries its corrected Session; the correction announces nothing itself.
	it('announces a replacement with the Slot and its corrected Session', async () => {
		const follower = await followAsOperator(eventId, eventRealtimeChannel(eventId), [
			'featureMatch:updated',
		]);

		try {
			const replaced = await paste(ZORO_DECK);

			const message = await follower.hear('featureMatch:updated', (data) =>
				JSON.stringify(data).includes('"mainboardCount":6'),
			);

			const reference = { id: replaced.deckList.id, mainboardCount: 6 };
			const { featureMatch } = message;
			expect(featureMatch.player1Data.gameData).toMatchObject({
				leader: { number: 'OP01-001' },
				featureMatchDeckList: reference,
			});
			expect(featureMatch.activeSession).toMatchObject({
				id: sessionId,
				sourceSnapshot: {
					player1: {
						data: {
							gameData: { featureMatchDeckList: reference },
						},
					},
				},
			});
		} finally {
			follower.stop();
		}
	});
});
