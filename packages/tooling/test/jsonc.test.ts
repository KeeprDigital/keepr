import { expect, it } from 'vitest';
import { parseJsonc } from '../scripts/jsonc.mjs';

it('reads a Wrangler config: drops comments and trailing commas, and leaves strings alone', () => {
	expect(parseJsonc('{\n\t// a comment\n\t"a": "x // y", /* b */ "b": [1, 2,],\n}')).toEqual({
		a: 'x // y',
		b: [1, 2],
	});
});

it.each([
	['a line comment', '{ "a": [1, // the last\n], }'],
	['a block comment', '{ "a": [1, /* the last */ ], /* end */ }'],
])('accepts a trailing comma followed by %s, as Wrangler does', (_case, text) => {
	expect(parseJsonc(text)).toEqual({ a: [1] });
});
