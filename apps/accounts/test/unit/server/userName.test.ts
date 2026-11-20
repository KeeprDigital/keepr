import type { APIError } from 'better-auth/api';
import { describe, expect, it } from 'vitest';
import { userName } from '~~/server/utils/userName';

// A User always has a name: one that is blank once trimmed, or no text at all,
// is refused, and a name is kept trimmed.

function refusalOf(value: unknown) {
	try {
		userName(value);
		return null;
	} catch (error) {
		const { statusCode, body } = error as APIError;
		return { statusCode, code: body?.code };
	}
}

describe('a User’s name', () => {
	it.each([
		['empty', ''],
		['of nothing but spaces, tabs and line breaks', ' \t\r\n '],
		['no text at all', null],
	])('%s is refused', (_case, value) => {
		expect(refusalOf(value)).toEqual({ statusCode: 400, code: 'NAME_REQUIRED' });
	});

	it('is kept trimmed', () => {
		expect(userName('  Ada Lovelace\n')).toBe('Ada Lovelace');
	});
});
