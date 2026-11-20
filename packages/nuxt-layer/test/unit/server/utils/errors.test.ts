import { createError } from 'h3';
import { describe, expect, it } from 'vitest';
import { isStateConflictFailure, StateConflictError } from '../../../../server/utils/errors';
import { STATE_CONFLICT_CODE } from '../../../../shared/utils/stateConflict';

// A caller absorbs a lost race and nothing else: a 409 that is a refusal, a
// held lease or a reused id, is the authority's answer and must propagate.
describe('isStateConflictFailure', () => {
	it.each([
		{ case: 'a State Conflict', failure: new StateConflictError('Screen', 1), race: true },
		{
			case: 'a 409 marked as a State Conflict',
			failure: createError({ statusCode: 409, data: { code: STATE_CONFLICT_CODE } }),
			race: true,
		},
		{
			case: 'an unmarked 409',
			failure: createError({ statusCode: 409, message: 'commandId has already been used' }),
			race: false,
		},
		{
			case: 'a 409 marked otherwise',
			failure: createError({ statusCode: 409, data: { code: 'MELEE_SYNC_IN_PROGRESS' } }),
			race: false,
		},
		{
			case: 'another status marked as a State Conflict',
			failure: createError({ statusCode: 400, data: { code: STATE_CONFLICT_CODE } }),
			race: false,
		},
		{ case: 'a fault', failure: new Error('D1 unavailable'), race: false },
	])('answers $race for $case', ({ failure, race }) => {
		expect(isStateConflictFailure(failure)).toBe(race);
	});
});
