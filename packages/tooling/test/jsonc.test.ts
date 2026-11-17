import { expect, it } from 'vitest';
import { parseJsonc } from '../scripts/jsonc.mjs';

it('reads a Wrangler config: drops comments and trailing commas, and leaves strings alone', () => {
	expect(parseJsonc('{\n\t// a comment\n\t"a": "x // y", /* b */ "b": [1, 2,],\n}')).toEqual({
		a: 'x // y',
		b: [1, 2],
	});
});
