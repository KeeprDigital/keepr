import { describe, expect, it } from 'vitest';
import {
	isStateConflictFetchFailure,
	STATE_CONFLICT_CODE,
} from '../../../shared/utils/stateConflict';
import { transportFailure } from '../../helpers/transportFailure';

/** Only a 409 the server marked as a lost race is replayed; any other 409 is a refusal. */
describe('isStateConflictFetchFailure', () => {
	const marked = { data: { code: STATE_CONFLICT_CODE } };

	it.each([
		['a marked 409', transportFailure({ status: 409, body: marked }), true],
		['a 409 carrying its status as `status` alone', { status: 409, data: marked }, true],
		['a 409 carrying it as `statusCode` alone', { statusCode: 409, data: marked }, true],
		['an unmarked 409, a refusal', transportFailure({ status: 409, body: {} }), false],
		[
			'a 409 marked with another code',
			transportFailure({ status: 409, body: { data: { code: 'not-in-mode' } } }),
			false,
		],
		['a marked failure of another status', transportFailure({ status: 400, body: marked }), false],
		['a 409 with no body', { statusCode: 409 }, false],
		['null', null, false],
		['a string', 'state-conflict', false],
	])('answers %s', (_label, failure, conflict) => {
		expect(isStateConflictFetchFailure(failure)).toBe(conflict);
	});
});
