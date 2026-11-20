import { describe, expect, it } from 'vitest';
import { failureRetryAfterSeconds } from '../../../../app/utils/failureRetryAfter';
import { failureStatus } from '../../../../app/utils/failureStatus';
import { transportFailure } from '../../../helpers/transportFailure';

describe('failureStatus', () => {
	it.each([
		['a $fetch failure', transportFailure({ status: 403 }), 403],
		['a failure carrying `status` alone', { status: 410 }, 410],
		['one carrying `statusCode` alone', { statusCode: 401 }, 401],
		['one carrying both, where `statusCode` wins', { statusCode: 502, status: 500 }, 502],
		['an ordinary Error', new Error('offline'), undefined],
		['null', null, undefined],
		['undefined', undefined, undefined],
	])('reads %s', (_label, failure, status) => {
		expect(failureStatus(failure)).toBe(status);
	});
});

describe('failureRetryAfterSeconds', () => {
	const answering = (retryAfter: string | null) => ({
		response: {
			headers: new Headers(retryAfter === null ? {} : { 'retry-after': retryAfter }),
		},
	});

	it.each([
		['delta-seconds', answering('30'), 30],
		['delta-seconds padded with whitespace', answering(' 5 '), 5],
		['zero', answering('0'), 0],
		['an HTTP-date', answering('Wed, 21 Oct 2026 07:28:00 GMT'), undefined],
		['a negative number', answering('-1'), undefined],
		['a fraction', answering('1.5'), undefined],
		['an empty value', answering(''), undefined],
		['no header', answering(null), undefined],
		['no response', new Error('offline'), undefined],
		['null', null, undefined],
	])('reads %s', (_label, failure, seconds) => {
		expect(failureRetryAfterSeconds(failure)).toBe(seconds);
	});
});
