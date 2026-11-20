import type { APIError } from 'better-auth/api';
import { describe, expect, it } from 'vitest';
import { userName } from '~~/server/utils/userName';
import { MAX_USER_NAME_LENGTH } from '~~/shared/utils/userName';

// A User always has a name: one that is blank once trimmed, or no text at all,
// is refused, as is one too long or carrying a control character; a name is kept trimmed.

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

	it.each([
		['one character too long', 'a'.repeat(MAX_USER_NAME_LENGTH + 1), 'NAME_TOO_LONG'],
		['carrying a line break inside it', 'Ada\nLovelace', 'NAME_INVALID'],
		['carrying a tab inside it', 'Ada\tLovelace', 'NAME_INVALID'],
		['carrying a delete character', 'Ada\u007F', 'NAME_INVALID'],
		['carrying a C1 control character', 'Ada\u0085Lovelace', 'NAME_INVALID'],
	])('%s is refused', (_case, value, code) => {
		expect(refusalOf(value)).toEqual({ statusCode: 400, code });
	});

	it('of the longest length is kept, counted once trimmed', () => {
		const longest = 'a'.repeat(MAX_USER_NAME_LENGTH);
		expect(userName(` ${longest} `)).toBe(longest);
	});

	it('is kept trimmed', () => {
		expect(userName('  Ada Lovelace\n')).toBe('Ada Lovelace');
	});
});
