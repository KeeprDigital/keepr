import type { H3Event } from 'h3';
import type { IdentityProofSource } from '@keepr/nuxt-layer/server/utils/requestIdentity';
import { safeErrorLogPath } from '@keepr/nuxt-layer/server/utils/errorLogPath';

/**
 * Where a write's time went on its way to its Event's object, as one log line
 * per write that called the object: `realtime_write_timed` (#1363).
 *
 * A late write (a Take that lands on air a second late) was seen on Staging with
 * nothing to say which step held it. The line times each: who the request
 * belongs to (the Session's Identity Proof, and whether Keepr Accounts had to be
 * asked for one while it waited), D1, and each call to the Event's object,
 * beside the whole write and how many requests the Worker's isolate had served,
 * a first being a cold one.
 *
 * A step's time is the sum of its calls, and calls may overlap: the steps need
 * not add up to the whole, whose remainder is everything not timed. In a Worker
 * the clock moves only across I/O, which every timed step is, so each reads true
 * there; time spent computing shows only in the whole, and in the invocation's
 * own CPU time beside it in the log.
 */

/** The steps of a write the line times. */
export type WriteStep = 'identity' | 'd1' | 'publish';

/** Where a request keeps its timing while it lives. */
const WRITE_TIMING_CONTEXT_KEY = 'writeTiming';

/** The methods that only read, whose requests are not timed. */
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** How many requests this isolate has been handed, counting the one being handled. */
let isolateRequests = 0;

interface StepTally {
	ms: number;
	calls: number;
	failures: number;
}

/** The request a line describes, as the response leaves it. */
export interface TimedRequest {
	method: string;
	path: string | undefined;
	statusCode: number;
}

export interface WriteTiming {
	/** Runs `work` as one call of `step`, timed however it settles. */
	time: <T>(step: WriteStep, work: () => Promise<T>) => Promise<T>;
	/** Records how the request's Identity Proof was had. */
	identityProof: (source: IdentityProofSource) => void;
	/** The log line, or `null` for a write that never called its Event's object. */
	fields: (request: TimedRequest) => ReturnType<typeof writeTimingFields> | null;
}

function writeTimingFields(
	request: TimedRequest,
	totalMs: number,
	steps: Record<WriteStep, StepTally>,
	identityProof: IdentityProofSource | null,
	isolateRequest: number,
) {
	return {
		message: 'realtime_write_timed',
		method: request.method,
		path: safeErrorLogPath(request.path) ?? null,
		statusCode: request.statusCode,
		totalMs,
		identityMs: steps.identity.calls > 0 ? steps.identity.ms : null,
		identityProof,
		d1Ms: steps.d1.ms,
		d1Queries: steps.d1.calls,
		publishMs: steps.publish.ms,
		publishCalls: steps.publish.calls,
		publishFailures: steps.publish.failures,
		isolateRequest,
	};
}

/**
 * One write's timing, from `startedAt` on `clock`, for the isolate's
 * `isolateRequest`th request.
 */
export function createWriteTiming(
	isolateRequest: number,
	clock: () => number = Date.now,
): WriteTiming {
	const startedAt = clock();
	const steps: Record<WriteStep, StepTally> = {
		identity: { ms: 0, calls: 0, failures: 0 },
		d1: { ms: 0, calls: 0, failures: 0 },
		publish: { ms: 0, calls: 0, failures: 0 },
	};
	let identityProof: IdentityProofSource | null = null;

	return {
		async time(step, work) {
			const began = clock();
			const tally = steps[step];
			try {
				return await work();
			} catch (failure) {
				tally.failures += 1;
				throw failure;
			} finally {
				tally.ms += clock() - began;
				tally.calls += 1;
			}
		},
		identityProof(source) {
			identityProof = source;
		},
		fields(request) {
			if (steps.publish.calls === 0) return null;
			return writeTimingFields(request, clock() - startedAt, steps, identityProof, isolateRequest);
		},
	};
}

/** The timing a request carries, if it is a write. */
export function writeTimingOf(event: H3Event): WriteTiming | undefined {
	return event.context[WRITE_TIMING_CONTEXT_KEY] as WriteTiming | undefined;
}

/**
 * Counts the request against its isolate, and starts timing it if it is a
 * write. Called as each request arrives (`server/plugins/write-timing.ts`).
 */
export function beginWriteTiming(event: H3Event, clock: () => number = Date.now): void {
	isolateRequests += 1;
	if (READ_METHODS.has(event.method)) return;
	event.context[WRITE_TIMING_CONTEXT_KEY] = createWriteTiming(isolateRequests, clock);
}

/** Logs the write's line once its response is sent, if it called its Event's object. */
export function logWriteTiming(event: H3Event): void {
	const fields = writeTimingOf(event)?.fields({
		method: event.method,
		path: event.path,
		statusCode: event.node.res.statusCode,
	});
	// Workers Logs indexes the object's fields.
	if (fields) console.log(fields);
}

/**
 * Runs `work` as one call of `step` of the write being handled, if any: in a
 * scheduled run, a request that only reads, or a unit test, it simply runs.
 * For code that holds no request, as D1 and the realtime publish do not; the
 * request is found as `requestAfterAnswer` in `realtimePublish.ts` finds it.
 */
export async function timeWriteStep<T>(step: WriteStep, work: () => Promise<T>): Promise<T> {
	let timing: WriteTiming | undefined;
	try {
		timing = writeTimingOf(useEvent());
	} catch {
		timing = undefined;
	}
	return timing ? await timing.time(step, work) : await work();
}
