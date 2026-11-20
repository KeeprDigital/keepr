import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getMatchFormatDefaults } from '~~/shared/config/games';
import { createInitialFeatureMatchSessionStateFromSnapshot } from '~~/shared/modules/feature-match-session';
import { fromFeatureMatchDefaults } from '~~/shared/types/featureMatchDefaults';
import { deferred } from '@keepr/nuxt-layer/test/helpers/deferred';
import { commanderSnapshot } from '~~/test/helpers/featureMatchSnapshots';
import { createMockEvent } from '~~/test/helpers/fixtures';
import {
	createSession,
	EVENT_ID,
	MATCH_ID,
	sessionClient,
} from '~~/test/nuxt/helpers/featureMatchStateHarness';
import CommanderTable from '~/components/FeatureMatch/State/CommanderTable.vue';

/*
 * A Commander Slot's Controls on the real Nuxt UI and the real Feature Match
 * State store, faking only the Session's network: an operator's press shows
 * at its Seat while its command is out.
 */

vi.mock('~/modules/feature-match-session/client', async () => {
	const { sessionClient } = await import('~~/test/nuxt/helpers/featureMatchSessionClientMock');
	return {
		useFeatureMatchSessionClient: () => sessionClient,
	};
});

const snapshot = commanderSnapshot({ player4: null });

async function mountTable() {
	resetAllEventStores();
	useEventStore().event = createMockEvent({
		id: EVENT_ID,
		game: 'mtg',
		variant: 'commander',
		...fromFeatureMatchDefaults(getMatchFormatDefaults('mtg-commander')),
	}) as never;
	const state = { ...createInitialFeatureMatchSessionStateFromSnapshot(snapshot), turnNumber: 1 };
	useFeatureMatchStateStore().cacheSession(createSession(state, { sourceSnapshot: snapshot }));
	return mountSuspended(CommanderTable, { props: { matchId: MATCH_ID } });
}

describe("a Commander Slot's Controls on Nuxt UI", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("checks a Seat's Eliminated switch and marks the Seat out while the command is out", async () => {
		sessionClient.setEliminated.mockReturnValueOnce(deferred().promise);
		const wrapper = await mountTable();
		const seat = () => wrapper.get('[data-seat="player2"]');
		const toggle = () => seat().get('button[role="switch"]');
		expect(toggle().attributes('aria-checked')).toBe('false');

		await toggle().trigger('click');
		await flushPromises();

		expect({
			checked: toggle().attributes('aria-checked'),
			eliminated: seat().attributes('data-eliminated'),
		}).toEqual({ checked: 'true', eliminated: 'true' });
	});

	it("steps a Seat's life down from its own counter", async () => {
		sessionClient.updatePlayerFeatureMatchState.mockReturnValue(deferred().promise);
		const wrapper = await mountTable();
		const seat = wrapper.get('[data-seat="player3"]');
		const life = () =>
			(seat.get('input[aria-label$=" life total"]').element as HTMLInputElement).value;

		const before = life();
		await seat.get('button[aria-label^="Decrease"][aria-label$=" life total"]').trigger('click');
		await flushPromises();

		expect([before, life()]).toEqual(['40', '39']);
	});
});
