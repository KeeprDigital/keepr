/**
 * A provider's error that names its refusal by number, as four suites need to raise it.
 *
 * An `Error` with a numeric `code` and an HTTP `statusCode` is a shape that still
 * reaches the failure logs: R2's binding throws its errors with a numeric `code`, and
 * `RealtimePublishError` carries one in its own. A provider's class need not assign
 * `name`, and this one does not, so it reports the inherited `'Error'` — which is why
 * `errorName` alone cannot carry the diagnosis, and why the numeric `code` #264
 * restored is the field that does.
 *
 * `code` is typed `unknown` because the shapes worth testing include the ones a
 * thrower's declared type disallows: a code built with `Number(…)` from something
 * absent is `NaN`.
 */
export class CodedProviderError extends Error {
	href?: string;
	detail?: Record<string, string>;
	constructor(
		message: string,
		readonly code: unknown,
		readonly statusCode: number,
	) {
		super(message);
	}
}

/**
 * A provider that will not accept this server's key: 404 / 40400 "No application found".
 *
 * The failure the whole legibility cluster is built around — #242 diagnosed it
 * from the client, #253 put it in the publish log, #264 stopped it wearing the
 * Screen-command route's own 404.
 */
export function providerRefusal(): CodedProviderError {
	return new CodedProviderError('No application found', 40400, 404);
}
