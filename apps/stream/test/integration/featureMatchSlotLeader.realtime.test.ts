import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eventRealtimeChannel } from '../../shared/utils/realtimeChannels';
import { LAW, NAMI, ZORO } from '../helpers/opCards';
import { $fetch } from './client';
import { followAsOperator } from './realtimeFollower';

// A Slot side's Leader on a One Piece Event (ADR-0057): a change during a
// Feature Match Session reaches its snapshot and its followers.

function side(name: string, sideLeader: unknown) {
	return {
		name,
		gameData: { type: 'op', leader: sideLeader },
	};
}

describe("a Feature Match Slot side's Leader", () => {
	let eventId: number;
	let slotId: number;
	let sessionId: number;

	beforeAll(async () => {
		const event = await $fetch('/api/events', {
			method: 'POST',
			body: {
				name: 'Integration One Piece Leaders',
				game: 'op',
				featureMatchOrientation: 'horizontal',
			},
		});
		eventId = event.id;
		const slot = await $fetch(`/api/events/${eventId}/feature-match-slots`, {
			method: 'POST',
			body: {
				player1Data: side('Ana', ZORO),
				player2Data: side('Ben', LAW),
			},
		});
		slotId = slot.id;
		const session = await $fetch(`/api/events/${eventId}/feature-match-slots/${slotId}/sessions`, {
			method: 'POST',
		});
		sessionId = session.id;
		// The side holds another Leader mid-Session, so picking Zoro below is a change.
		await changeLeader(NAMI);
	});

	afterAll(async () => {
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		} catch {}
	});

	async function changeLeader(sideLeader: unknown) {
		return await $fetch(`/api/events/${eventId}/feature-match-slots/${slotId}/setup`, {
			method: 'PATCH',
			body: {
				player1Data: side('Ana', sideLeader),
			},
		});
	}

	// The Slot's own announcement carries its corrected Session; the correction announces nothing itself.
	it('announces the change with the Slot and its corrected Session', async () => {
		const follower = await followAsOperator(eventId, eventRealtimeChannel(eventId), [
			'featureMatch:updated',
		]);

		try {
			await changeLeader(ZORO);

			const message = await follower.hear('featureMatch:updated', (data) =>
				JSON.stringify(data).includes('Roronoa Zoro'),
			);

			const { featureMatch } = message;
			expect(featureMatch.player1Data.gameData).toEqual({ type: 'op', leader: ZORO });
			expect(featureMatch.activeSession).toMatchObject({
				id: sessionId,
				sourceSnapshot: {
					player1: {
						data: {
							gameData: { type: 'op', leader: ZORO },
						},
					},
				},
			});
		} finally {
			follower.stop();
		}
	});
});
