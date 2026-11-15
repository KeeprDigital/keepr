import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ATRAXA, KRAUM, TYMNA, typedSeat } from '../helpers/commanders';
import { $fetch, anonymousFetch } from './client';
import { commandId, getFeatureMatchSlot, requireActiveSession, sendFeatureMatchCommand } from './featureMatchSessionHelpers';

// What a vMix JSON Data Source reads of a Commander Slot: an anonymous GET of
// one row, live state as of the read (ADR-0056, ADR-0087). The row's rules are
// `featureMatchPublicRow`'s.
describe('a Commander Slot\'s public Feature Match read', () => {
	let eventId: number;
	let slotId: number;

	beforeAll(async () => {
		const event = await $fetch('/api/events', {
			method: 'POST',
			body: {
				name: 'Integration Commander Public Read',
				game: 'mtg',
				variant: 'commander',
				featureMatchOrientation: 'horizontal',
			},
		});
		eventId = event.id;
		const slot = await $fetch(`/api/events/${eventId}/feature-match-slots`, { method: 'POST', body: {} });
		slotId = slot.id;
		await $fetch(`/api/events/${eventId}/feature-match-slots/${slotId}/setup`, {
			method: 'PATCH',
			body: {
				player1Data: typedSeat('Ana', [ATRAXA]),
				player2Data: typedSeat('Ben', [TYMNA, KRAUM]),
				player3Data: typedSeat('Cleo', [TYMNA]),
			},
		});
	});

	afterAll(async () => {
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		}
		catch {}
	});

	async function publicRow() {
		const response = await anonymousFetch(`/api/public/events/${eventId}/feature-match-slots/${slotId}`);
		return {
			status: response.status,
			cors: response.headers.get('access-control-allow-origin'),
			rows: await response.json() as Array<Record<string, string>>,
		};
	}

	it('answers an anonymous reader one row of the Seats, and the next read what the operator changed since', async () => {
		const opened = await publicRow();

		expect(opened).toMatchObject({ status: 200, cors: '*' });
		expect(opened.rows).toEqual([
			expect.objectContaining({
				player1Name: 'Ana',
				player2Deck: 'Tymna the Weaver / Kraum, Ludevic\'s Opus',
				player3Life: '40',
				player3Eliminated: '#00000000',
				player4Name: '',
				player4Life: '',
			}),
		]);

		const session = requireActiveSession(await getFeatureMatchSlot(eventId, slotId));
		const damaged = await sendFeatureMatchCommand(eventId, session.id, {
			commandId: commandId('AdjustCommanderDamage'),
			type: 'AdjustCommanderDamage',
			payload: {
				player: 'player1',
				from: 'player2',
				commander: 1,
				delta: 9,
			},
			baseSequence: session.sequence,
		});
		await sendFeatureMatchCommand(eventId, session.id, {
			commandId: commandId('SetEliminated'),
			type: 'SetEliminated',
			payload: { player: 'player3', eliminated: true },
			baseSequence: damaged.sequence,
		});

		expect((await publicRow()).rows).toEqual([
			{
				...opened.rows[0],
				player1Life: '31',
				player3Eliminated: '#FFFFFFFF',
			},
		]);
	});
});
