/**
 * What a failed realtime publish is allowed to say, and what it becomes.
 *
 * Two answers to one failure, kept together because they are the same judgement
 * read by different audiences. `publishFailureFields` is what the log may carry
 * — the failure's own account, bounded and named field by field. The error
 * class is what a caller that cannot swallow the failure raises instead: this
 * server's own classification, carrying none of the failure's text.
 *
 * A publish is an RPC to the Event's object (ADR-0137), so what fails it is the
 * Workers runtime's error for an object it could not reach, whatever the object
 * threw, or the realtime layer's for a Worker with no binding. #253 built the
 * fields and #264 the classification, both for Ably's refusals; the judgement
 * is kept for whatever throws.
 */

/**
 * How much of a failure's own message the log will carry.
 *
 * A message is usually a short phrase, but nothing bounds what a thrower puts in
 * one: Ably's transport once put a whole response body there. Bounded rather
 * than dropped: the phrase is the diagnosis.
 */
export const MAX_PUBLISH_FAILURE_REASON_CHARS = 200;

// A `NaN` would render as null through `JSON.stringify` anyway. The guard is
// here so the declared `number | null` is true of the value and not merely of
// how one caller serialises it.
function finiteNumberOrNull(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * What a failed publish is allowed to say about why it failed.
 *
 * The fields are named, not copied: an error can carry anything, request
 * context included, and nothing else on it is read. `statusCode` and
 * `errorCode` are a failure's own `statusCode` and `code` where it has them. A
 * failed RPC has neither as a rule, so both are null and `reason` is the
 * diagnosis.
 *
 * Total by construction: each field is validated rather than trusted, and a
 * throw that is not an Error, or one whose properties refuse to be read,
 * yields nulls. The caller is a catch block that must not itself throw — a
 * failure here would turn a deliberately swallowed publish into a 500 on a
 * route whose write has already committed.
 */
export function publishFailureFields(error: unknown) {
	try {
		const info = error as
			| { statusCode?: unknown; code?: unknown; message?: unknown }
			| null
			| undefined;
		return {
			statusCode: finiteNumberOrNull(info?.statusCode),
			errorCode: finiteNumberOrNull(info?.code),
			errorName: error instanceof Error ? error.name : null,
			reason:
				typeof info?.message === 'string'
					? info.message.slice(0, MAX_PUBLISH_FAILURE_REASON_CHARS)
					: null,
		};
	} catch {
		return {
			statusCode: null,
			errorCode: null,
			errorName: null,
			reason: null,
		};
	}
}

/**
 * The sentence a caller gets when a publish it cannot do without failed.
 *
 * Fixed text, and deliberately incurious: the failure's own account is in the
 * log line beside it, and a response body is the wrong place for text this
 * server did not write. `test/integration/realtimeDiagnosis.ts` matches on this
 * exact string to tell a failed publish from the route's own answers — that
 * file imports nothing by design, so the string is a literal on both sides and
 * `realtimeDiagnosis.test.ts` pins the two together through the real mapping.
 */
export const REALTIME_PUBLISH_FAILED_MESSAGE = 'Realtime publish failed';

/**
 * A publish that failed, as this server's own failure.
 *
 * The class exists because of what h3 does with a bare throw: `createError`
 * adopts `statusCode` from any thrown object, so a failure carrying a 404
 * becomes the *route's* 404 — the same answer the Screen-command route gives
 * for a Screen that does not exist (#242, #264). Two failures with different
 * owners would arrive indistinguishable, and the caller would be told to check
 * its identifiers.
 *
 * 502 rather than 500: the request was well-formed and this server's own work
 * succeeded — what failed is what it depends on to deliver, which is what a Bad
 * Gateway says. Not swallowed, because the Screen-command route's 200 means the
 * command was delivered and nothing else (#242, recorded deliberately).
 *
 * `code` is the failure's own numeric code where it has one, carried so the
 * request's own log line can name it. It is read by `errorLogFields` and never
 * serialised into a response.
 */
export class RealtimePublishError extends Error {
	statusCode = 502;
	readonly code: number | null;

	constructor(cause: unknown) {
		super(REALTIME_PUBLISH_FAILED_MESSAGE, { cause });
		this.name = 'RealtimePublishError';
		this.code = publishFailureFields(cause).errorCode;
	}
}
