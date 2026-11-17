import type { ClockType } from '../types/enums';
import type { ClockState } from '../types/featureMatchState';
import {
	countdownNextChangeInMs,
	formatClockTime,
	formatCountdownTime,
} from '@keepr/nuxt-layer/shared/utils/clockTime';

// ──────────────── Count-up limit ────────────────

/** The bounds of a count-up limit, in minutes, as an operator enters it; none counts up without limit. */
export const COUNT_UP_LIMIT_MINUTES_MIN = 1;
export const COUNT_UP_LIMIT_MINUTES_MAX = 600;

/**
 * The overtime a clock that counts up after running out shows, `overMs` past
 * its end: it counts up to its limit, then holds there. A `null` limit never holds.
 */
export function countUpOvertimeMs(overMs: number, limitMs: number | null | undefined): number {
	const overtimeMs = Math.max(0, overMs);
	return limitMs == null ? overtimeMs : Math.min(overtimeMs, limitMs);
}

// ──────────────── Clock State Calculations ────────────────

/**
 * A Feature Match Session Clock as the app holds it: running from a server
 * instant, or stopped with the time it has run. Whether it runs is whether it
 * holds a start, so a clock running with no start, or stopped with one, cannot
 * be built. The stored Session state keeps its own shape (`ClockState`);
 * `readStoredClock` and `writeStoredClock` are where the two meet.
 */
export interface FeatureMatchClock {
	type: ClockType;
	durationMs: number;
	/** The time run before `startedAt`, or in all on a stopped clock. */
	elapsedMs: number;
	/** The server instant a running clock runs from; `null` on a stopped clock. */
	startedAt: number | null;
	/** Whether a countdown counts up after it runs out, showing its overtime. */
	countUpAfterCountdown: boolean;
	/** How far that overtime counts before holding; `null` counts up without limit. */
	countUpLimitMs: number | null;
}

/**
 * A stored clock as the app holds it. One stored running with no start reads as
 * stopped at its stored elapsed time, a start stored on a stopped clock is
 * ignored, and one stored before the count-up limit existed has no limit.
 */
export function readStoredClock(stored: ClockState): FeatureMatchClock {
	return {
		type: stored.type,
		durationMs: stored.durationMs,
		elapsedMs: stored.elapsedMs,
		startedAt: stored.isRunning ? (stored.lastStartedAt ?? null) : null,
		countUpAfterCountdown: stored.countUpAfterCountdown,
		countUpLimitMs: stored.countUpLimitMs ?? null,
	};
}

/** Whether a stored clock runs, as `readStoredClock` reads it: one stored running with no start does not. */
export function storedClockRuns(stored: ClockState): boolean {
	return readStoredClock(stored).startedAt !== null;
}

/** A clock in the shape the Session state stores and its reads and messages carry. */
export function writeStoredClock(clock: FeatureMatchClock): ClockState {
	return {
		type: clock.type,
		durationMs: clock.durationMs,
		elapsedMs: clock.elapsedMs,
		isRunning: clock.startedAt !== null,
		lastStartedAt: clock.startedAt,
		countUpAfterCountdown: clock.countUpAfterCountdown,
		countUpLimitMs: clock.countUpLimitMs,
	};
}

/** The time a clock has run by `now`, never below zero: the one elapsed-time sum. */
export function getEffectiveElapsedMs(clock: FeatureMatchClock, now: number): number {
	const runningMs = clock.startedAt === null ? 0 : now - clock.startedAt;
	return Math.max(0, clock.elapsedMs + runningMs);
}

/**
 * Whether a clock is counting, wherever its time stands: `running`, `paused`
 * once any time has run, or `stopped` before any has.
 */
export function clockRunState(clock: FeatureMatchClock): 'running' | 'paused' | 'stopped' {
	if (clock.startedAt !== null) return 'running';
	return clock.elapsedMs > 0 ? 'paused' : 'stopped';
}

/**
 * Where a Feature Match Session Clock stands. Where its time stands outranks
 * whether it is counting: a countdown past its end is `run-out`, or, counting up
 * after, `counting-up` until it is `holding` at its count-up limit, running or
 * not. With time left it is `running`, `paused` once any time has run, or
 * `stopped` before any has. An Untimed Match's clock is `untimed`.
 */
export type FeatureMatchClockState =
	| 'untimed'
	| 'stopped'
	| 'paused'
	| 'running'
	| 'run-out'
	| 'counting-up'
	| 'holding';

export interface FeatureMatchClockProjection {
	state: FeatureMatchClockState;
	/** Whether the clock runs, wherever its time stands: a clock that has run out may still be running. */
	isRunning: boolean;
	/** What the clock shows: a time, or the Untimed Label for an untimed clock. */
	display: string;
	/** The time run, by the stored time and, while running, the time since its start. */
	elapsedMs: number;
	/** The time a countdown has left, never below zero; `null` for any other clock. */
	remainingMs: number | null;
	/** How long until `display` next changes, or `null` if it never will on its own. */
	nextChangeInMs: number | null;
}

/**
 * A Feature Match Session Clock at `now` (server time): one pure projection, so
 * what a rendering shows, the state it reads and when it next changes cannot
 * disagree. A countdown shows its time remaining, its overtime once run out if
 * it counts up after (holding at its count-up limit, ADR-0076), and any other
 * clock its elapsed time; an untimed clock shows the Event's Untimed Label, and
 * no clock `0:00`. Whether a blank Untimed Label hides the clock is the caller's
 * to decide. Time remaining rounds up and changes as each whole second remaining
 * is reached, its last at the end; elapsed time and overtime round down and
 * change on the whole second (ADR-0078). Only a running clock changes.
 */
export function projectFeatureMatchClock(
	clock: FeatureMatchClock | null,
	now: number,
	untimedLabel: string,
): FeatureMatchClockProjection {
	if (!clock) {
		return {
			state: 'stopped',
			isRunning: false,
			display: formatClockTime(0),
			elapsedMs: 0,
			remainingMs: null,
			nextChangeInMs: null,
		};
	}

	const elapsedMs = getEffectiveElapsedMs(clock, now);
	const isRunning = clock.startedAt !== null;
	if (clock.type === 'untimed') {
		return {
			state: 'untimed',
			isRunning,
			display: untimedLabel.trim(),
			elapsedMs,
			remainingMs: null,
			nextChangeInMs: null,
		};
	}

	/** Its state while it has time left, or has no end to reach. */
	const stateBeforeEnd = clockRunState(clock);

	if (clock.type !== 'countdown') {
		return {
			state: stateBeforeEnd,
			isRunning,
			display: formatClockTime(elapsedMs),
			elapsedMs,
			remainingMs: null,
			nextChangeInMs: isRunning ? 1000 - (elapsedMs % 1000) : null,
		};
	}

	const remainingMs = clock.durationMs - elapsedMs;
	if (remainingMs > 0) {
		return {
			state: stateBeforeEnd,
			isRunning,
			display: formatCountdownTime(remainingMs),
			elapsedMs,
			remainingMs,
			nextChangeInMs: isRunning ? countdownNextChangeInMs(remainingMs) : null,
		};
	}

	if (!clock.countUpAfterCountdown) {
		return {
			state: 'run-out',
			isRunning,
			display: formatClockTime(0),
			elapsedMs,
			remainingMs: 0,
			nextChangeInMs: null,
		};
	}

	const overMs = -remainingMs;
	const holds = clock.countUpLimitMs != null && overMs >= clock.countUpLimitMs;
	return {
		state: holds ? 'holding' : 'counting-up',
		isRunning,
		display: formatClockTime(countUpOvertimeMs(overMs, clock.countUpLimitMs)),
		elapsedMs,
		remainingMs: 0,
		nextChangeInMs: isRunning && !holds ? 1000 - (overMs % 1000) : null,
	};
}

export interface ClockAdjustmentInput {
	deltaDisplayMs?: number;
	targetDisplayMs?: number;
}

/**
 * Move a clock by `deltaDisplayMs`, or set it to `targetDisplayMs`.
 *
 * On a countdown a delta moves the end: `+` gives time back, `−` takes it away.
 * A countdown counting up past its end keeps that direction, its overtime being
 * time remaining below zero: `−` lengthens the overtime it shows (what it holds
 * at, if it holds at its count-up limit), `+` shortens it and, past zero, counts
 * down again. A `−` before the end stops at the end, and a set-to always sets a
 * time of that length, which on a countdown is time remaining.
 */
export function applyClockAdjustment(
	clock: FeatureMatchClock,
	now: number,
	adjustment: ClockAdjustmentInput,
): FeatureMatchClock {
	const effectiveElapsedMs = getEffectiveElapsedMs(clock, now);
	const inOvertime =
		clock.type === 'countdown' &&
		clock.countUpAfterCountdown &&
		effectiveElapsedMs >= clock.durationMs;
	let currentDisplayMs = effectiveElapsedMs;
	if (inOvertime)
		currentDisplayMs = -countUpOvertimeMs(
			effectiveElapsedMs - clock.durationMs,
			clock.countUpLimitMs,
		);
	else if (clock.type === 'countdown')
		currentDisplayMs = Math.max(0, clock.durationMs - effectiveElapsedMs);

	const adjustedDisplayMs = currentDisplayMs + (adjustment.deltaDisplayMs ?? 0);
	const targetDisplayMs =
		adjustment.targetDisplayMs === undefined && inOvertime
			? adjustedDisplayMs
			: Math.max(0, adjustment.targetDisplayMs ?? adjustedDisplayMs);

	if (clock.type === 'countdown') {
		// A negative target is overtime, which is elapsed time past the duration.
		// More overtime than the clock has run cannot come off the duration alone.
		const durationMs = Math.max(0, effectiveElapsedMs + targetDisplayMs);
		return {
			...clock,
			durationMs,
			elapsedMs: durationMs - targetDisplayMs,
			startedAt: clock.startedAt === null ? null : now,
		};
	}

	return {
		...clock,
		elapsedMs: targetDisplayMs,
		startedAt: clock.startedAt === null ? null : now,
	};
}

// ──────────────── Clock Transitions ────────────────

/**
 * What an operator does to a Feature Match Session Clock, each a pure function
 * of the clock and the server instant it happens at. The Session reducer and
 * the operator's optimistic update apply these same functions, so a prediction
 * cannot differ from the answer. Which a Session refuses is the reducer's rule.
 * A transition that changes nothing hands back the clock it was given.
 */
export const clockTransitions = {
	/** Run a stopped clock from `at`. A running clock keeps the start it has. */
	start(clock: FeatureMatchClock, at: number): FeatureMatchClock {
		return clock.startedAt === null ? { ...clock, startedAt: at } : clock;
	},

	/** Stop a running clock, keeping the time it has run by `at`. */
	pause(clock: FeatureMatchClock, at: number): FeatureMatchClock {
		return clock.startedAt === null
			? clock
			: {
					...clock,
					elapsedMs: getEffectiveElapsedMs(clock, at),
					startedAt: null,
				};
	},

	/** Stop the clock with no time run, at a new duration if one is given. */
	reset(clock: FeatureMatchClock, durationMs?: number): FeatureMatchClock {
		return {
			...clock,
			elapsedMs: 0,
			startedAt: null,
			...(durationMs !== undefined && { durationMs }),
		};
	},

	/** Run the clock from `at` with no time run, whether or not it was running. */
	restart(clock: FeatureMatchClock, at: number): FeatureMatchClock {
		return {
			...clock,
			elapsedMs: 0,
			startedAt: at,
		};
	},

	/** Move what the clock shows by `deltaMs`, as `applyClockAdjustment` does. */
	adjust(clock: FeatureMatchClock, at: number, deltaMs: number): FeatureMatchClock {
		return applyClockAdjustment(clock, at, { deltaDisplayMs: deltaMs });
	},

	/** Set what the clock shows to `targetMs`, as `applyClockAdjustment` does. */
	set(clock: FeatureMatchClock, at: number, targetMs: number): FeatureMatchClock {
		return applyClockAdjustment(clock, at, { targetDisplayMs: targetMs });
	},
};
