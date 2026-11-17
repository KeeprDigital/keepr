import { describe, expect, it } from 'vitest';
import { intervalAnchorForStep, projectInterval } from '../../../shared/utils/interval';

// An interval is equal periods counted from an anchor: every reader at one
// instant answers the same step, and when the next begins.
describe('an interval', () => {
	const ANCHOR = 1_000_000;
	const PERIOD = 10_000;

	it.each([
		{
			at: 'its anchor',
			now: ANCHOR,
			projection: { step: 0, elapsedInStepMs: 0, nextStepInMs: 10_000 },
		},
		{
			at: 'the last millisecond of a period',
			now: ANCHOR + 9_999,
			projection: { step: 0, elapsedInStepMs: 9_999, nextStepInMs: 1 },
		},
		{
			at: 'the instant a period ends',
			now: ANCHOR + 10_000,
			projection: { step: 1, elapsedInStepMs: 0, nextStepInMs: 10_000 },
		},
		{
			at: 'a much later instant, in step with its anchor',
			now: ANCHOR + 85_000,
			projection: { step: 8, elapsedInStepMs: 5_000, nextStepInMs: 5_000 },
		},
		{
			at: 'a fractional instant',
			now: ANCHOR + 12_000.5,
			projection: { step: 1, elapsedInStepMs: 2_000.5, nextStepInMs: 7_999.5 },
		},
	])('at $at', ({ now, projection }) => {
		expect(projectInterval(ANCHOR, PERIOD, now)).toEqual(projection);
	});

	it('stands at the start of its first period before its anchor, which ends one period after it', () => {
		expect(projectInterval(ANCHOR, PERIOD, ANCHOR - 5_000)).toEqual({
			step: 0,
			elapsedInStepMs: 0,
			nextStepInMs: 15_000,
		});
	});

	it.each([0, -1])('never steps with a period of %i', (periodMs) => {
		expect(projectInterval(ANCHOR, periodMs, ANCHOR + 95_000)).toEqual({
			step: 0,
			elapsedInStepMs: 0,
			nextStepInMs: null,
		});
	});

	it('anchors a step so that it begins now and holds one full period', () => {
		const now = 500_000.25;
		const anchor = intervalAnchorForStep(2, PERIOD, now);

		expect(projectInterval(anchor, PERIOD, now)).toEqual({
			step: 2,
			elapsedInStepMs: 0,
			nextStepInMs: PERIOD,
		});
		expect(projectInterval(anchor, PERIOD, now + PERIOD - 1).step).toBe(2);
		expect(projectInterval(anchor, PERIOD, now + PERIOD).step).toBe(3);
	});
});
