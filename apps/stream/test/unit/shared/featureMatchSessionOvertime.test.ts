import type { FeatureMatchState } from '~~/shared/types/featureMatchState';
import { describe, expect, it } from 'vitest';
import {
	applyFeatureMatchSessionEvent,
	normalizeFeatureMatchSessionCommandPayload,
} from '~~/shared/modules/feature-match-session';
import { createInitialFeatureMatchState } from '~~/shared/types/featureMatchState';
import { twoPlayerSnapshot } from '~~/test/helpers/featureMatchSnapshots';

const MINUTE = 60_000;

/** A 50-minute countdown started at 0 and running. */
function runningCountdown(): FeatureMatchState {
	const state = createInitialFeatureMatchState(20, 'countdown', 50 * MINUTE);
	return applyFeatureMatchSessionEvent(state, twoPlayerSnapshot(), 'StartClock', { at: 0 })
		.currentState;
}

function startOvertime(state: FeatureMatchState, at: number, totalTurns = 5) {
	return applyFeatureMatchSessionEvent(state, twoPlayerSnapshot(), 'StartOvertime', {
		totalTurns,
		at,
	}).currentState;
}

describe('extra turns', () => {
	// The server's own projection of the clock decides, not the page that asked.
	it.each([
		['with time left on the clock', 49 * MINUTE, undefined],
		['once the clock has run out', 50 * MINUTE, 5],
	])('a StartOvertime %s starts them: %s', (_case, at, turnsRemaining) => {
		expect(startOvertime(runningCountdown(), at).overtime?.turnsRemaining).toBe(turnsRemaining);
	});

	it('refuses a StartOvertime while a paused countdown has time left', () => {
		const paused = applyFeatureMatchSessionEvent(
			runningCountdown(),
			twoPlayerSnapshot(),
			'PauseClock',
			{ at: 10 * MINUTE },
		).currentState;

		expect(startOvertime(paused, 60 * MINUTE).overtime).toBeUndefined();
	});

	it('changes nothing once extra turns are under way', () => {
		const started = startOvertime(runningCountdown(), 50 * MINUTE, 5);
		const stepped = applyFeatureMatchSessionEvent(started, twoPlayerSnapshot(), 'StepOvertime', {
			delta: 2,
		}).currentState;

		const again = startOvertime(stepped, 51 * MINUTE, 5);

		expect(again).toBe(stepped);
		expect(again.overtime).toMatchObject({ turnsRemaining: 3, totalTurns: 5 });
	});

	it("is stamped with the server's time, whatever the page sent", () => {
		expect(
			normalizeFeatureMatchSessionCommandPayload(
				'StartOvertime',
				{ totalTurns: 5, at: 1 },
				() => 42,
			),
		).toEqual({ totalTurns: 5, at: 42 });
	});
});
