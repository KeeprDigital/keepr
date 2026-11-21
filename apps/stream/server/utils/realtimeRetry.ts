/**
 * Trying a failed publish again once the write has answered (ADR-0162).
 *
 * A deploy resets an Event's object, and a reset can outlast the two calls a
 * publish makes at once. A request the Worker lets finish work after its answer
 * (`waitUntil`) tries the publish again behind the answer, each time after a
 * longer wait, so the write does not wait on the object and a page still hears
 * what it announced once the object answers.
 *
 * The waits add up to 21 s, inside the 30 s a Worker keeps a request's
 * `waitUntil` alive after it answers.
 */

/** The waits before each attempt after the answer, in turn. */
export const PUBLISH_RETRY_AFTER_ANSWER_MS = [1_000, 5_000, 15_000] as const;

/** Where a request can finish work after answering. */
export interface FinishesAfterAnswer {
	waitUntil: (work: Promise<unknown>) => void;
}

/**
 * Try `attempt` again after each of `PUBLISH_RETRY_AFTER_ANSWER_MS`, until one
 * resolves, behind the request's answer. `giveUp` is told the last failure. A
 * request that cannot take the work gives up at once, so nothing is lost
 * silently.
 */
export function retryAfterAnswer(
	request: FinishesAfterAnswer,
	attempt: () => Promise<unknown>,
	giveUp: (failure: unknown) => void,
	firstFailure: unknown,
): void {
	let abandoned = false;
	const retrying = (async () => {
		let failure = firstFailure;
		for (const ms of PUBLISH_RETRY_AFTER_ANSWER_MS) {
			await new Promise((resolve) => setTimeout(resolve, ms));
			if (abandoned) return;
			try {
				await attempt();
				return;
			} catch (error) {
				failure = error;
			}
		}
		giveUp(failure);
	})();
	try {
		request.waitUntil(retrying);
	} catch {
		abandoned = true;
		giveUp(firstFailure);
	}
}
