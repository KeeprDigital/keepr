/**
 * The timings of the test Worker's brief classes (`worker/index.ts`), short
 * enough for a test to wait out and long enough that a busy machine does not
 * outlast them between two steps. Both the Worker and the tests read them here.
 */
export const BRIEF_RETENTION_MS = 300;
export const BRIEF_GRACE_MS = 1500;
export const BRIEF_SWEEP_MS = 1500;
/**
 * `BriefAsk`: an ask soon, and a sweep long enough after it that a test can
 * answer, or put the object to sleep and answer, before the alarm looks again.
 */
export const BRIEF_ASK_MS = 1000;
export const ASKED_SWEEP_MS = 3000;
