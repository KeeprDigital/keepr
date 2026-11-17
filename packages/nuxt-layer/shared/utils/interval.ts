/**
 * An interval: equal periods counted from an anchor instant. Which period is
 * current, and when the next begins, is a pure function of the anchor, the
 * period and `now`, so every reader of one interval at one instant agrees and
 * nothing writes as it runs. A Page Rotation's pages and a Social Profile
 * Rotation's steps are each counted by one.
 */
export interface IntervalProjection {
	/** The whole periods passed since the anchor: 0 through the first, and before the anchor. */
	step: number;
	/** How far into its current period the interval is; 0 before the anchor. */
	elapsedInStepMs: number;
	/** How long until the next period begins, or `null` if it never will. */
	nextStepInMs: number | null;
}

/**
 * An interval at `now`. Before its anchor it stands at the start of its first
 * period, which still ends one period after the anchor. One with no period
 * (zero or less) never steps.
 */
export function projectInterval(anchor: number, periodMs: number, now: number): IntervalProjection {
	if (!(periodMs > 0)) return { step: 0, elapsedInStepMs: 0, nextStepInMs: null };

	const elapsedMs = now - anchor;
	if (elapsedMs < 0) return { step: 0, elapsedInStepMs: 0, nextStepInMs: periodMs - elapsedMs };

	const elapsedInStepMs = elapsedMs % periodMs;
	return {
		step: Math.floor(elapsedMs / periodMs),
		elapsedInStepMs,
		nextStepInMs: periodMs - elapsedInStepMs,
	};
}

/** The anchor an interval takes for `step` to begin at `now`: it holds one full period from there. */
export function intervalAnchorForStep(step: number, periodMs: number, now: number): number {
	return now - step * periodMs;
}
