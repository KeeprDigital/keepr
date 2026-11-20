import { describe, expect, test } from 'vitest';

import { deepFrozen } from '../src/index.ts';

describe('deepFrozen', () => {
	test('freezes every object and list it reaches, and returns the same value', () => {
		const value = { list: [{ inner: { depth: 3 } }], plain: 1 };
		const frozen = deepFrozen(value);
		expect(frozen).toBe(value);
		for (const each of [frozen, frozen.list, frozen.list[0], frozen.list[0]?.inner])
			expect(Object.isFrozen(each)).toBe(true);
	});
});
