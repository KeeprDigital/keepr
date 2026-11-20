import { describe, expect, it } from 'vitest';
import {
	addMembersSchema,
	batchRemoveMembersSchema,
	PLAYER_LIST_REORDER_MAX_MEMBERS,
	reorderMembersSchema,
} from '~~/server/schemas/api/playerList';

const ids = (count: number) => Array.from({ length: count }, (_, index) => index + 1);

describe.each([
	['addMembersSchema', addMembersSchema],
	['batchRemoveMembersSchema', batchRemoveMembersSchema],
] as const)('%s', (_name, schema) => {
	it.each([
		['one Player', ids(1), true],
		['500 Players', ids(500), true],
		['no Players', [], false],
		['501 Players', ids(501), false],
		['a duplicate Player', [1, 1], false],
	])('takes %s → %s', (_case, playerIds, accepted) => {
		expect(schema.safeParse({ playerIds }).success).toBe(accepted);
	});
});

// A reorder names every member, and a list grows past 500 one add at a time.
describe('reorderMembersSchema', () => {
	it.each([
		['one Player', ids(1), true],
		['501 Players', ids(501), true],
		['the most a reorder names', ids(PLAYER_LIST_REORDER_MAX_MEMBERS), true],
		['one Player more', ids(PLAYER_LIST_REORDER_MAX_MEMBERS + 1), false],
		['no Players', [], false],
		['a duplicate Player', [1, 1], false],
	])('takes %s → %s', (_case, playerIds, accepted) => {
		expect(reorderMembersSchema.safeParse({ playerIds }).success).toBe(accepted);
	});
});
