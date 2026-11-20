import { describe, expect, it } from 'vitest';
import { withoutShadowedCookie } from '~~/server/utils/retiredSignInCookie';

const NAME = '__Secure-session';

describe('a Cookie header that carries one name more than once', () => {
	it.each([
		['twice', `${NAME}=old; ${NAME}=new`, `${NAME}=new`],
		['three times', `${NAME}=a; ${NAME}=b; ${NAME}=c`, `${NAME}=c`],
		[
			'among others, which keep their place',
			`a=1; ${NAME}=old; b=2; ${NAME}=new; c=3`,
			`a=1; b=2; ${NAME}=new; c=3`,
		],
		['with a value that holds an equals sign', `${NAME}=old=; ${NAME}=new==`, `${NAME}=new==`],
	])('keeps the last when it carries it %s', (_case, header, kept) => {
		expect(withoutShadowedCookie(header, NAME)).toBe(kept);
	});

	it.each([
		['once', `a=1; ${NAME}=only`],
		['never', 'a=1; b=2'],
		['only as the start of another name', `${NAME}_data=1; ${NAME}=only`],
		['not at all: no header', undefined],
	])('is left as it came when it carries it %s', (_case, header) => {
		expect(withoutShadowedCookie(header, NAME)).toBeNull();
	});
});
