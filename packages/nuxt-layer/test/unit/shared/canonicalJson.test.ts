import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../../../shared/utils/canonicalJson';

describe('canonicalJson', () => {
	it.each([
		[
			'orders keys by codepoint at every depth',
			{ b: 1, a: { d: [{ z: 1, y: 2 }], c: 2 } },
			'{"a":{"c":2,"d":[{"y":2,"z":1}]},"b":1}',
		],
		[
			'orders integer-like keys as text, not as numbers',
			{ 10: 'x', 2: 'y', a: 'z' },
			'{"10":"x","2":"y","a":"z"}',
		],
		['orders by codepoint, not locale', { b: 1, B: 2, é: 3 }, '{"B":2,"b":1,"é":3}'],
		[
			'drops an undefined or function entry, as stored JSON reads back',
			{ a: undefined, b: () => 1, c: null },
			'{"c":null}',
		],
		['carries an undefined array entry as null, as JSON does', [undefined, 1], '[null,1]'],
		[
			'renders a value through its toJSON',
			{ at: new Date('2026-01-02T03:04:05.000Z') },
			'{"at":"2026-01-02T03:04:05.000Z"}',
		],
		['escapes keys and strings', { 'a"b': 'c\nd' }, '{"a\\"b":"c\\nd"}'],
	])('%s', (_, value, expected) => {
		expect(canonicalJson(value)).toBe(expected);
	});

	it('renders the same document in another key order identically', () => {
		expect(canonicalJson({ x: { p: 1, q: [1, 2] }, y: 'v' })).toBe(
			canonicalJson({ y: 'v', x: { q: [1, 2], p: 1 } }),
		);
	});
});
