import type { FeatureMatchState } from '~~/shared/types/featureMatchState';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyFeatureMatchSessionEvent } from '~~/shared/modules/feature-match-session';
import { createMockEvent, createMockFeatureMatchState } from '~~/test/helpers/fixtures';
import {
	clock,
	commandResult,
	createSession,
	createSourceSnapshot,
	EVENT_ID,
	MATCH_ID,
	sessionClient,
} from '~~/test/nuxt/helpers/featureMatchStateHarness';

vi.mock('~/modules/feature-match-session/client', async () => {
	const { sessionClient } = await import('~~/test/nuxt/helpers/featureMatchSessionClientMock');
	return { useFeatureMatchSessionClient: () => sessionClient };
});

const event = createMockEvent({
	featureMatchDefaultExtraTurnsEnabled: true,
	featureMatchDefaultExtraTurns: 5,
});
mockNuxtImport('useEventStore', () => () => ({
	eventId: EVENT_ID,
	event,
	displayEvent: event,
}));
mockNuxtImport('useServerTime', async () =>
	(await import('@keepr/nuxt-layer/test/nuxt/helpers/serverTime')).fakeServerTime(),
);

const NOW = 10_000_000;

/** A countdown that ran out a minute ago, while no page was open. */
const runOut = clock({ durationMs: 60_000, isRunning: true, lastStartedAt: NOW - 120_000 });

/** The Session as the server holds it: each StartOvertime reduced at the server's time. */
function serveSession(state: FeatureMatchState) {
	let held = state;
	let sequence = 3;
	sessionClient.startOvertime.mockImplementation(async (_eventId, _slotId, totalTurns) => {
		held = applyFeatureMatchSessionEvent(held, createSourceSnapshot(), 'StartOvertime', {
			totalTurns,
			at: Date.now(),
		}).currentState;
		return commandResult(held, { sequence: ++sequence });
	});
}

describe('extra turns on the Feature Match Controls', () => {
	let store: ReturnType<typeof useFeatureMatchStateStore>;

	beforeEach(() => {
		vi.useFakeTimers({ now: NOW });
		vi.clearAllMocks();
		store = useFeatureMatchStateStore();
		store.$reset();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	function open(state: FeatureMatchState) {
		serveSession(state);
		store.cacheSession(createSession(state));
		useFeatureMatchGameMode(
			MATCH_ID,
			computed(() => store.featureMatchStates.get(MATCH_ID) ?? null),
		);
	}

	it.each([
		['on a page opened after the clock ran out', runOut, 0],
		[
			'as the clock runs out on an open page',
			clock({ durationMs: 60_000, isRunning: true, lastStartedAt: NOW - 59_000 }),
			1_000,
		],
	])('start %s', async (_case, held, wait) => {
		open(createMockFeatureMatchState({ clock: held }));
		await vi.advanceTimersByTimeAsync(wait);

		expect(store.featureMatchStates.get(MATCH_ID)?.overtime).toMatchObject({
			turnsRemaining: 5,
			totalTurns: 5,
		});
	});

	it('under way stay where they are: 3 of 5 left stays 3 of 5', async () => {
		open(
			createMockFeatureMatchState({
				clock: runOut,
				overtime: { active: true, turnsRemaining: 3, totalTurns: 5 },
			}),
		);
		await vi.advanceTimersByTimeAsync(0);

		expect(store.featureMatchStates.get(MATCH_ID)?.overtime).toMatchObject({
			turnsRemaining: 3,
			totalTurns: 5,
		});
	});
});
