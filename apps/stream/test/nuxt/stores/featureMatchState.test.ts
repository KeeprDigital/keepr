import type { FeatureMatchSessionEventAppliedPayload } from '~~/shared/types/featureMatchSession';
import type { FeatureMatchState } from '~~/shared/types/featureMatchState';
import type { MessageData } from '~/types/realtime';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '@keepr/nuxt-layer/test/helpers/deferred';
import { createMockFeatureMatchState } from '~~/test/helpers/fixtures';
import { transportFailure } from '@keepr/nuxt-layer/test/helpers/transportFailure';
import {
	clock,
	commandResult,
	createSession,
	createSourceSnapshot,
	EVENT_ID,
	MATCH_ID,
	seedState as seed,
	SERVER_NOW,
	sessionClient,
} from '~~/test/nuxt/helpers/featureMatchStateHarness';

vi.mock('~/modules/feature-match-session/client', async () => {
	const { sessionClient } = await import('~~/test/nuxt/helpers/featureMatchSessionClientMock');
	return {
		useFeatureMatchSessionClient: () => sessionClient,
	};
});

mockNuxtImport('useServerTime', () => () => ({
	getServerTime: () => SERVER_NOW,
}));

// Batched writes flush at once, so a test sees each write as soon as it is made.
vi.mock('@vueuse/core', async () => {
	const actual = await vi.importActual<typeof import('@vueuse/core')>('@vueuse/core');
	return {
		...actual,
		useDebounceFn: (fn: (...args: any[]) => any) => fn,
	};
});

describe('useFeatureMatchStateStore', () => {
	let store: ReturnType<typeof useFeatureMatchStateStore>;

	const seedState = (overrides?: Partial<FeatureMatchState>, matchId = MATCH_ID) =>
		seed(store, overrides, matchId);
	const held = (matchId = MATCH_ID) => store.featureMatchStates.get(matchId)!;

	beforeEach(() => {
		store = useFeatureMatchStateStore();
		store.$reset();
	});

	describe('loadState', () => {
		it("holds the Slot's Session: its state, id and sequence", async () => {
			const state = createMockFeatureMatchState();
			sessionClient.ensureSession.mockResolvedValue(createSession(state));

			await store.loadState(EVENT_ID, MATCH_ID);

			expect(held()).toEqual(state);
			expect(store.sessionIdBySlotId.get(MATCH_ID)).toBe(500);
			expect(store.sessionSequenceBySlotId.get(MATCH_ID)).toBe(3);
			expect(store.currentEventId).toBe(EVENT_ID);
		});

		it.each([
			[
				'no Session',
				() => sessionClient.ensureSession.mockResolvedValue(null),
				'Feature match session not found',
			],
			[
				'a refusal',
				() =>
					sessionClient.ensureSession.mockRejectedValue(
						transportFailure({
							status: 409,
							body: { message: 'That Feature Match slot is not assigned to a match yet' },
						}),
					),
				'That Feature Match slot is not assigned to a match yet',
			],
		])('reports a load answered with %s', async (_, answer, reported) => {
			answer();

			await store.loadState(EVENT_ID, MATCH_ID);

			expect(store.featureMatchStates.get(MATCH_ID)).toBeUndefined();
			expect(store.error).toBe(reported);
		});
	});

	it("reads the active Feature Match's state", () => {
		const state = seedState({}, 42);

		store.setActiveFeatureMatch(42);

		expect(store.activeState).toEqual(state);

		store.setActiveFeatureMatch(null);

		expect(store.activeFeatureMatchId).toBeNull();
	});

	describe('updateState', () => {
		it('shows a partial update, merging player fields, while its write is out', async () => {
			seedState({ turnNumber: 1 });
			const answer = deferred<unknown>();
			sessionClient.updateState.mockReturnValueOnce(answer.promise);

			const updating = store.updateState(EVENT_ID, MATCH_ID, {
				turnNumber: 5,
				player1: { lifeTotal: 15 },
			});

			expect(held().turnNumber).toBe(5);
			expect(held().player1).toMatchObject({ lifeTotal: 15, gameWins: 0 });

			answer.resolve(commandResult(createMockFeatureMatchState({ turnNumber: 5 })));
			await updating;
		});

		it('rolls back every field of a refused multi-field save, leaving no partial state, and reports why', async () => {
			const state = seedState({ turnNumber: 2 });
			sessionClient.updateState.mockRejectedValue(
				transportFailure({
					status: 409,
					body: { message: 'Feature match session has advanced' },
				}),
			);

			await store.updateState(EVENT_ID, MATCH_ID, {
				turnNumber: 9,
				activePlayer: 'player2',
				player1: { lifeTotal: 3 },
				clock: { targetDisplayMs: 60_000 },
			});

			expect(store.error).toBe('Feature match session has advanced');
			expect(held()).toEqual(state);
		});

		it('predicts a clock save as the display reading, not raw elapsed milliseconds', async () => {
			// Paused countdown: 50:00 duration, 10:00 elapsed, so the panel shows 40:00.
			seedState({
				clock: clock({ durationMs: 50 * 60 * 1000, elapsedMs: 10 * 60 * 1000 }),
			});
			const answer = deferred<unknown>();
			sessionClient.updateState.mockReturnValueOnce(answer.promise);

			const updating = store.updateState(EVENT_ID, MATCH_ID, {
				clock: { targetDisplayMs: 10 * 60 * 1000 },
			});

			expect(held().clock.durationMs - held().clock.elapsedMs).toBe(10 * 60 * 1000);

			answer.resolve(commandResult());
			await updating;
		});
	});

	describe("a peer's applied Session event", () => {
		function sessionEvent(
			overrides: Partial<FeatureMatchSessionEventAppliedPayload> = {},
		): MessageData<'featureMatchSession:eventApplied'> {
			return {
				eventId: EVENT_ID,
				timestamp: Date.now(),
				slotId: MATCH_ID,
				sessionId: 500,
				sequence: 4,
				eventType: 'SetTurnNumber',
				sourceSnapshot: createSourceSnapshot(),
				currentState: createMockFeatureMatchState({ turnNumber: 4 }),
				...overrides,
			};
		}

		it('applies the next event for the current Session, with its snapshot', async () => {
			store.cacheSession(createSession());

			await store.applyRemoteSessionEvent(
				sessionEvent({
					sourceSnapshot: {
						...createSourceSnapshot(),
						bestOf: 5,
					},
				}),
			);

			expect(held().turnNumber).toBe(4);
			expect(store.sessionSequenceBySlotId.get(MATCH_ID)).toBe(4);
			expect(store.featureMatchSessions.get(500)?.sourceSnapshot.bestOf).toBe(5);
			expect(store.featureMatchSessions.get(500)?.sequence).toBe(4);
		});

		it('switches to a newer active Session at once', async () => {
			store.cacheSession(createSession());
			const nextState = createMockFeatureMatchState({ currentGame: 2 });

			await store.applyRemoteSessionEvent(
				sessionEvent({ sessionId: 600, sequence: 1, currentState: nextState }),
			);

			expect(store.sessionIdBySlotId.get(MATCH_ID)).toBe(600);
			expect(store.sessionSequenceBySlotId.get(MATCH_ID)).toBe(1);
			expect(held()).toEqual(nextState);
			expect(store.featureMatchSessions.get(600)?.currentState).toEqual(nextState);
		});

		it('re-reads the Session when a sequence gap shows an event was missed', async () => {
			store.cacheSession(createSession());
			sessionClient.ensureSession.mockResolvedValue(
				createSession(createMockFeatureMatchState({ turnNumber: 8 })),
			);

			await store.applyRemoteSessionEvent(sessionEvent({ sequence: 6 }));

			expect(sessionClient.ensureSession).toHaveBeenCalledWith(EVENT_ID, MATCH_ID);
			expect(held().turnNumber).toBe(8);
		});
	});

	// Two quick taps on one control: both are sent, one after the other, and the last shows.
	it.each([
		[
			'cards kept',
			() => {
				store.setCardsKept(EVENT_ID, MATCH_ID, 'player1', 6);
				return store.setCardsKept(EVENT_ID, MATCH_ID, 'player1', 5);
			},
			sessionClient.updatePlayerFeatureMatchState,
			(state: FeatureMatchState) => state.player1.cardsKept,
			5,
		],
		[
			'the turn number',
			() => {
				store.setTurnNumber(EVENT_ID, MATCH_ID, 3);
				return store.setTurnNumber(EVENT_ID, MATCH_ID, 4);
			},
			sessionClient.updateState,
			(state: FeatureMatchState) => state.turnNumber,
			4,
		],
		[
			'Eliminated',
			() => {
				store.setEliminated(EVENT_ID, MATCH_ID, 'player2', true);
				return store.setEliminated(EVENT_ID, MATCH_ID, 'player2', false);
			},
			sessionClient.setEliminated,
			(state: FeatureMatchState) => state.player2.eliminated,
			false,
		],
		[
			'a winner, then taking it back',
			() => {
				store.setOutcome(EVENT_ID, MATCH_ID, { winner: 'player1' });
				return store.setOutcome(EVENT_ID, MATCH_ID, null);
			},
			sessionClient.setOutcome,
			(state: FeatureMatchState) => state.outcome,
			undefined,
		],
	] as const)('lands both of two quick taps on %s', async (_case, tap, sent, read, last) => {
		seedState();
		// The server answers each with the state the tap predicted.
		sent.mockImplementation(async () => commandResult(held()));

		await tap();
		await vi.waitFor(() => expect(sent).toHaveBeenCalledTimes(2));

		expect(read(held())).toEqual(last);
	});
});
