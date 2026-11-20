import { describe, expect, it } from 'vitest';
import { isPlainObject, isPlainRecord } from '../../../shared/utils/plainObject';

class Instance {
	field = 1;
}

/** A record is any object but a list; a plain object is one JSON could have parsed. */
describe('plain object checks', () => {
	it.each([
		['an object literal', { a: 1 }, true, true],
		['an object with no prototype', Object.create(null) as object, true, true],
		['a class instance', new Instance(), true, false],
		['a Date', new Date(0), true, false],
		['a list', [1], false, false],
		['null', null, false, false],
		['a string', 'a', false, false],
		['a function', () => ({}), false, false],
	])('answers %s', (_label, value, record, plain) => {
		expect(isPlainRecord(value)).toBe(record);
		expect(isPlainObject(value)).toBe(plain);
	});
});
