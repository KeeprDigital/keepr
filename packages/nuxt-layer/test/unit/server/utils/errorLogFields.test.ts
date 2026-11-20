import type { LoggedNitroError } from '../../../../server/utils/errorLogFields';
import { describe, expect, it } from 'vitest';
import { errorLogFields } from '../../../../server/utils/errorLogFields';
import { TemporarilyUnavailableError } from '../../../../server/utils/errors';
import { CodedProviderError, providerRefusal } from '../../../helpers/providerRefusal';

describe('the fields a failed request logs', () => {
	function failed(overrides: Partial<LoggedNitroError>): LoggedNitroError {
		return { name: 'Error', statusCode: 500, ...overrides };
	}

	it('carries a provider code that arrives as a number', () => {
		// #264: a provider may name its refusal by number (R2 does), and a
		// string-only guard logged `null` for precisely the failure the field
		// exists to name.
		expect(
			errorLogFields(
				failed({
					cause: providerRefusal(),
				}),
				'/api/events/1',
			),
		).toMatchObject({
			// A provider's class need not assign `name`, so the sibling field
			// reports the inherited 'Error' and identifies nothing. The code is the
			// only thing in the line that can name the refusal.
			errorName: 'Error',
			errorCode: 40400,
		});
	});

	it('still carries a provider code that arrives as a string', () => {
		// Node's own convention, and the shape the previous guard was written for.
		expect(
			errorLogFields(
				failed({
					cause: { name: 'SystemError', code: 'ENOENT' },
				}),
				'/api/events/1',
			),
		).toMatchObject({ errorName: 'SystemError', errorCode: 'ENOENT' });
	});

	it('reports a NaN code as absent rather than as a number', () => {
		// A code built with `Number(…)` from something absent is NaN, which no
		// one can look up. #253 guards the same value the same way in the
		// publish log.
		expect(
			errorLogFields(
				failed({
					cause: new CodedProviderError('', Number.NaN, 502),
				}),
				'/api/events/1',
			),
		).toMatchObject({ errorCode: null });
		expect(
			errorLogFields(
				failed({
					cause: new CodedProviderError('', Number.POSITIVE_INFINITY, 502),
				}),
				'/api/events/1',
			),
		).toMatchObject({ errorCode: null });
	});

	it('reports a code that is neither string nor number as absent', () => {
		// Widening the guard must not turn it into no guard: an object or a
		// boolean in `code` is not an identifier anyone can look up.
		expect(
			errorLogFields(
				failed({
					cause: {
						code: { value: 40400 },
					},
				}),
				'/api/events/1',
			),
		).toMatchObject({ errorCode: null });
		expect(
			errorLogFields(
				failed({
					cause: { code: true },
				}),
				'/api/events/1',
			),
		).toMatchObject({ errorCode: null });
	});

	it('walks the cause chain for a code the nearest cause does not carry, keeping the class name', () => {
		// #323: a class like `TemporarilyUnavailableError` names the failure but
		// carries no code, so before this walk the store exception's own code —
		// the one thing that says WHY the store refused — never reached the log.
		const error = failed({
			cause: new TemporarilyUnavailableError('Graphic Asset Content is temporarily unavailable', {
				cause: { name: 'R2Error', code: 'R2_CONNECTION_LOST' },
			}),
		});
		expect(errorLogFields(error, '/api/events/1')).toMatchObject({
			errorName: 'TemporarilyUnavailableError',
			errorCode: 'R2_CONNECTION_LOST',
		});
	});

	it('prefers the nearest valid code over a deeper one', () => {
		// A domain error's own code is the classification; the store code under it
		// is only the fallback for a level that classifies nothing.
		const error = failed({
			cause: {
				name: 'GraphicsAssetLibraryError',
				code: 'invalid-ingestion-input',
				cause: { code: 'ENOENT' },
			},
		});
		expect(errorLogFields(error, '/api/events/1')).toMatchObject({
			errorName: 'GraphicsAssetLibraryError',
			errorCode: 'invalid-ingestion-input',
		});
	});

	it('skips an invalid code and keeps walking', () => {
		// An object in `code` is not an identifier anyone can look up; the number
		// beneath it is.
		expect(
			errorLogFields(
				failed({
					cause: {
						code: { value: 1 },
						cause: { code: 40400 },
					},
				}),
				'/api/events/1',
			),
		).toMatchObject({ errorCode: 40400 });
	});

	it('bounds the walk, so a cycle terminates and a too-deep code stays absent', () => {
		const cyclic: { code?: unknown; cause?: unknown } = {};
		cyclic.cause = cyclic;
		expect(errorLogFields(failed({ cause: cyclic }), '/api/events/1')).toMatchObject({
			errorCode: null,
		});

		const tooDeep = Array.from({ length: 5 }).reduce<object>((cause) => ({ cause }), {
			code: 'BURIED',
		});
		expect(errorLogFields(failed({ cause: tooDeep }), '/api/events/1')).toMatchObject({
			errorCode: null,
		});
	});

	it('reports an absent unhandled flag as handled, and a set one as unhandled', () => {
		// `unhandled: false` means something classified the failure, never that the flag was absent.
		expect(errorLogFields(failed({}), '/api/events/1')).toMatchObject({ unhandled: false });
		expect(errorLogFields(failed({ unhandled: false }), '/api/events/1')).toMatchObject({
			unhandled: false,
		});
		expect(errorLogFields(failed({ unhandled: true }), '/api/events/1')).toMatchObject({
			unhandled: true,
		});
	});

	it("falls back to the error's own name, and to no code at all, without a cause", () => {
		expect(
			errorLogFields(failed({ name: 'TypeError', statusCode: 500, unhandled: true }), undefined),
		).toEqual({
			message: 'api_request_failed',
			path: null,
			statusCode: 500,
			errorName: 'TypeError',
			errorCode: null,
			errorCause: null,
			failedStep: null,
			unhandled: true,
		});
	});
});

describe('what a failure was, with no user data', () => {
	function failed(overrides: Partial<LoggedNitroError>): LoggedNitroError {
		return { name: 'Error', statusCode: 500, unhandled: true, ...overrides };
	}

	/** D1's refusal as a Worker meets it: workerd's prefixed Error, inside Drizzle's, which quotes the query and its values. */
	function d1Failure(platformText: string) {
		const d1 = new Error(platformText, {
			cause: new Error(platformText.replace(/^D1_\w+: /, '')),
		});
		return new Error(
			'Failed query: update "screens" set "label" = ? where "id" = ?\nparams: Secret Label,12',
			{ cause: d1 },
		);
	}

	it.each([
		[
			'D1_ERROR: D1 DB storage operation exceeded timeout which caused object to be reset.',
			'd1_timeout',
		],
		['D1_ERROR: D1 DB is overloaded. Requests queued for too long.', 'd1_overloaded'],
		['D1_ERROR: Network connection lost.', 'd1_network_lost'],
		["D1_ERROR: D1 DB's isolate exceeded its memory limit and was reset.", 'd1_reset'],
		['D1_ERROR: Cannot resolve D1 DB due to transient issue on remote node.', 'd1_unavailable'],
		['D1_ERROR: UNIQUE constraint failed: screens.label: SQLITE_CONSTRAINT', 'd1_error'],
		["D1_TYPE_ERROR: Type 'object' not supported for value 'Secret Label'", 'd1_type_error'],
	])('names %j as %s', (platformText, errorCause) => {
		const line = errorLogFields(failed({ cause: d1Failure(platformText) }), '/api/events/1');

		expect(line).toMatchObject({ errorName: 'Error', errorCode: null, errorCause });
		expect(JSON.stringify(line)).not.toMatch(/Secret Label|screens|params/);
	});

	it.each([
		[
			'a timeout of something else',
			new DOMException('signal timed out', 'TimeoutError'),
			'timeout',
		],
		['an error naming nothing it knows', new Error('Cannot read properties of undefined'), null],
		[
			'D1’s words quoted inside another message',
			new Error('Failed query: select 1\nparams: D1_ERROR: Network connection lost.'),
			null,
		],
		['no cause at all', undefined, null],
	])('names %s as %s', (_case, cause, errorCause) => {
		expect(errorLogFields(failed({ cause }), '/api/events/1')).toMatchObject({ errorCause });
	});

	it('names the step of the write that failed, and none where no step did', () => {
		expect(errorLogFields(failed({}), '/api/events/1', 'd1')).toMatchObject({ failedStep: 'd1' });
		expect(errorLogFields(failed({}), '/api/events/1')).toMatchObject({ failedStep: null });
	});
});
