import type { BetterAuthOptions } from 'better-auth';
import { APIError } from 'better-auth/api';
import { hasControlCharacter } from '~~/shared/utils/controlCharacter';
import { MAX_USER_NAME_LENGTH } from '~~/shared/utils/userName';
import { textField } from './textField';

/**
 * A User always has a name (`RULES.md` § User): an App shows who did something
 * by their name, and is given nothing else of another User (#1341).
 */

/**
 * The name `value` gives a User, trimmed. Blank once trimmed, or no text at all,
 * it is refused 400 `NAME_REQUIRED`; longer than `MAX_USER_NAME_LENGTH`
 * `NAME_TOO_LONG`; carrying a control character `NAME_INVALID`. Each is refused
 * as Better Auth refuses, so its own routes and Keepr Accounts' answer it alike
 * (`refusalFromAuth`).
 */
export function userName(value: unknown): string {
	const name = textField(value).trim();
	if (name.length === 0)
		throw APIError.from('BAD_REQUEST', { code: 'NAME_REQUIRED', message: 'Enter your name.' });
	if (name.length > MAX_USER_NAME_LENGTH)
		throw APIError.from('BAD_REQUEST', {
			code: 'NAME_TOO_LONG',
			message: `Enter a name of at most ${MAX_USER_NAME_LENGTH} characters.`,
		});
	if (hasControlCharacter(name))
		throw APIError.from('BAD_REQUEST', {
			code: 'NAME_INVALID',
			message: 'Enter your name on one line, without special characters.',
		});
	return name;
}

/**
 * The rule, held where every write of a User passes: the library's routes and
 * Keepr Accounts' own create and change a User through these, so no path sets a
 * name without it. A change that names no name is let through.
 */
export const userNameHooks = {
	create: {
		before: async (user) => ({ data: { ...user, name: userName(user.name) } }),
	},
	update: {
		before: async (user) =>
			user.name === undefined ? undefined : { data: { name: userName(user.name) } },
	},
} satisfies NonNullable<BetterAuthOptions['databaseHooks']>['user'];
