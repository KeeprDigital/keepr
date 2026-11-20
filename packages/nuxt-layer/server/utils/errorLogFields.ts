/** The parts of a Nitro error the failure log reads. */
export interface LoggedNitroError {
	name: string;
	statusCode: number;
	cause?: unknown;
	unhandled?: boolean;
}

/**
 * A provider's own identifier for a refusal, as a log line may carry it.
 *
 * Both types, because both arrive. Node's convention is a string ('ENOENT'), and
 * the guard this replaces accepted only those — but a provider may name its
 * refusal by number (R2's errors do, and `RealtimePublishError` carries one), so
 * a string-only guard logged `null` for exactly the failure the field exists to
 * name (#264).
 *
 * Finiteness mirrors the guard #253 put on the same value in the publish log: a
 * code a thrower built with `Number(…)` from something absent is `NaN`, which is
 * no identifier. `JSON.stringify` would render that as null anyway; the check is
 * what makes the declared type true of the value rather than true of one
 * serialisation. Nothing is coerced — a code that is neither a string nor a
 * number is absent, not `Number(code)`.
 */
function errorCodeOf(code: unknown): string | number | null {
	if (typeof code === 'string') return code;

	return typeof code === 'number' && Number.isFinite(code) ? code : null;
}

/**
 * How far down a cause chain the code search reaches. Deep enough for every
 * wrapping this codebase does (a route's classified error around a subsystem
 * class around a store exception is three), and a bound at all so a cyclic
 * cause terminates.
 */
const MAX_CAUSE_DEPTH = 5;

interface CauseRecord {
	name?: unknown;
	message?: unknown;
	code?: unknown;
	cause?: unknown;
}

/** Each object of a cause chain, nearest first, at most `MAX_CAUSE_DEPTH` of them. */
function* causeChain(cause: unknown): Generator<CauseRecord> {
	for (
		let record = cause, depth = 0;
		record && typeof record === 'object' && depth < MAX_CAUSE_DEPTH;
		record = (record as CauseRecord).cause, depth += 1
	)
		yield record as CauseRecord;
}

/**
 * The nearest valid code in the cause chain (#323).
 *
 * Nearest, not deepest: a domain error's own code is the classification, and a
 * store code beneath it is only the fallback for levels that classify nothing.
 * Before this walk the read stopped at one level, so a class like
 * `TemporarilyUnavailableError` — which names the failure but carries no code —
 * logged `errorCode: null` over the store exception whose code said why the store
 * refused.
 */
function nearestCauseCode(cause: unknown): string | number | null {
	for (const record of causeChain(cause)) {
		const code = errorCodeOf(record.code);
		if (code !== null) return code;
	}
	return null;
}

/**
 * D1's own words for a refusal of the platform's, as `D1_ERROR:` prefixes them,
 * and the token a log line names each by (#1376). First match wins: a storage
 * timeout also says the object was reset.
 */
const D1_PLATFORM_FAILURES: ReadonlyArray<readonly [RegExp, string]> = [
	[/exceeded timeout/i, 'd1_timeout'],
	[/overloaded/i, 'd1_overloaded'],
	[/network connection lost/i, 'd1_network_lost'],
	[/DB reset|was reset|object to be reset/i, 'd1_reset'],
	[/transient issue/i, 'd1_unavailable'],
];

/** The prefix workerd puts at the head of every error its D1 binding throws. */
const D1_PREFIX = /^(D1_[A-Z_]+):/;

/**
 * What a failure was, from a bounded vocabulary, or `null` where nothing in its
 * cause chain says (#1376).
 *
 * Every D1 refusal reaches a route as a plain `Error` (workerd's `D1_ERROR: …`,
 * usually inside Drizzle's `Failed query: …`), so neither the name nor the code
 * tells a D1 timeout from a bug. Messages are never logged: Drizzle's quotes the
 * query's values, and D1's may quote a value too. What is logged is D1's prefix,
 * which workerd writes at the head of its own message, refined by Cloudflare's
 * fixed text for the platform's refusals, or `timeout` for a `TimeoutError`.
 */
function errorCauseOf(cause: unknown): string | null {
	for (const { name, message } of causeChain(cause)) {
		if (name === 'TimeoutError') return 'timeout';
		if (typeof message !== 'string') continue;
		const prefix = D1_PREFIX.exec(message)?.[1];
		if (!prefix) continue;
		const platform =
			prefix === 'D1_ERROR'
				? D1_PLATFORM_FAILURES.find(([words]) => words.test(message))?.[1]
				: undefined;
		return platform ?? prefix.toLowerCase();
	}
	return null;
}

/**
 * The structured record of a failed request.
 *
 * Separate from the plugin that emits it so it can be exercised directly: what a
 * failure log says is the only account anybody gets of a production refusal, and
 * a field that silently reports `null` is worse than an absent one.
 *
 * The name comes from the nearest cause, so the line names the failure class;
 * the code may come from deeper, so the same line still carries the underlying
 * refusal's identifier when the class declares none. `errorCause` says what the
 * failure was where name and code cannot, and `failedStep` which step of the
 * request a caller saw fail, if it tracks steps (a write's, in Stream Keepr).
 */
export function errorLogFields(
	error: LoggedNitroError,
	path: string | undefined,
	failedStep: string | null = null,
) {
	const cause = error.cause;
	const causeRecord = cause && typeof cause === 'object' ? (cause as { name?: unknown }) : null;
	return {
		message: 'api_request_failed',
		path: path ?? null,
		statusCode: error.statusCode,
		errorName: typeof causeRecord?.name === 'string' ? causeRecord.name : error.name,
		errorCode: nearestCauseCode(cause),
		errorCause: errorCauseOf(cause),
		failedStep,
		unhandled: error.unhandled ?? false,
	};
}

/** A failure's class name for a structured log line, or `null` for a non-Error throw. */
export function errorNameOf(error: unknown): string | null {
	return error instanceof Error ? error.name : null;
}
