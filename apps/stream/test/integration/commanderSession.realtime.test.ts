import type { InboundMessage } from 'ably';
import Ably from 'ably';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eventRealtimeChannel } from '../../shared/utils/realtimeChannels';
import { ATRAXA, KRAUM, TYMNA, typedSeat } from '../helpers/commanders';
import { LOAD_TOLERANT_WAIT_MS } from '../helpers/loadTolerantBounds';
import { $fetch } from './client';
import {
	commandId,
	getFeatureMatchSlot,
	requireActiveSession,
	sendFeatureMatchCommand,
} from './featureMatchSessionHelpers';
import { INTEGRATION_ABLY_API_KEY, integrationRealtimeConfigured } from './realtimeKey';

// What a second browser on a Commander Event hears (ADR-0087): a Seat's
// Commander Damage as the Session event that applied it, and Swap Seats as the
// Slot's announcement, carrying each player's live state into their new Seat.
describe('a Commander Session followed over realtime', () => {
	let eventId: number;
	let slotId: number;

	beforeAll(async () => {
		const event = await $fetch('/api/events', {
			method: 'POST',
			body: {
				name: 'Integration Commander Realtime',
				game: 'mtg',
				variant: 'commander',
				featureMatchOrientation: 'horizontal',
			},
		});
		eventId = event.id;
		const slot = await $fetch(`/api/events/${eventId}/feature-match-slots`, {
			method: 'POST',
			body: {},
		});
		slotId = slot.id;
		await $fetch(`/api/events/${eventId}/feature-match-slots/${slotId}/setup`, {
			method: 'PATCH',
			body: {
				player1Data: typedSeat('Ana', [ATRAXA]),
				player2Data: typedSeat('Ben', [TYMNA, KRAUM]),
			},
		});
	});

	afterAll(async () => {
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		} catch {}
	});

	it.skipIf(!integrationRealtimeConfigured)(
		'announces Commander Damage and Swap Seats to a follower',
		async () => {
			const realtime = new Ably.Realtime(INTEGRATION_ABLY_API_KEY);
			const channel = realtime.channels.get(eventRealtimeChannel(eventId));
			const heard: InboundMessage[] = [];
			const waiters: Array<() => void> = [];
			const listener = (message: InboundMessage) => {
				heard.push(message);
				waiters.splice(0).forEach((wake) => wake());
			};
			const timers: Array<ReturnType<typeof setTimeout>> = [];
			async function hear(name: string, matches: (data: any) => boolean): Promise<any> {
				const deadline = Date.now() + LOAD_TOLERANT_WAIT_MS;
				for (;;) {
					const found = heard.find((message) => message.name === name && matches(message.data));
					if (found) return found.data;
					if (Date.now() > deadline) throw new Error(`Timed out waiting for ${name}`);
					await new Promise<void>((resolve) => {
						waiters.push(resolve);
						timers.push(setTimeout(resolve, 250));
					});
				}
			}

			try {
				await channel.subscribe(listener);
				const session = requireActiveSession(await getFeatureMatchSlot(eventId, slotId));

				await sendFeatureMatchCommand(eventId, session.id, {
					commandId: commandId('AdjustCommanderDamage'),
					type: 'AdjustCommanderDamage',
					payload: {
						player: 'player1',
						from: 'player2',
						commander: 2,
						delta: 6,
					},
					baseSequence: session.sequence,
				});
				const applied = await hear(
					'featureMatchSession:eventApplied',
					(data) => data.eventType === 'AdjustCommanderDamage',
				);
				expect(applied).toMatchObject({
					slotId,
					sessionId: session.id,
					sourceSnapshot: { variant: 'commander' },
				});
				expect(applied.currentState.player1).toMatchObject({
					lifeTotal: 34,
					commanderDamage: [{ seat: 'player2', commander: 2, damage: 6 }],
				});

				await $fetch(`/api/events/${eventId}/feature-match-slots/${slotId}/swap-seats`, {
					method: 'POST',
					body: {
						seats: ['player1', 'player4'],
					},
				});
				const swapped = await hear(
					'featureMatch:updated',
					(data) => data.featureMatch?.player4Data?.name === 'Ana',
				);
				expect(swapped.featureMatch.player1Data ?? null).toBeNull();
				expect(swapped.featureMatch.activeSession.currentState.player4).toMatchObject({
					lifeTotal: 34,
				});
			} finally {
				timers.forEach(clearTimeout);
				channel.unsubscribe(listener);
				realtime.close();
			}
		},
	);
});
