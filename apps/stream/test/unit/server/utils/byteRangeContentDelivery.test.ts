import { describe, expect, it } from 'vitest';
import {
	ifNoneMatchMatches,
	rangePermitted,
	requestedByteRange,
} from '~~/server/utils/byteRangeContentDelivery';

describe('requestedByteRange', () => {
	// RFC 9110 §14.2: a Range the server cannot or will not honour is ignored
	// (full 200); only a well-formed single range that misses the body is 416.
	it.each([
		{ header: undefined, expected: undefined },
		{ header: 'bytes=100-199', expected: { start: 100, end: 199 } },
		{ header: 'bytes=900-', expected: { start: 900, end: 999 } },
		{ header: 'bytes=990-5000', expected: { start: 990, end: 999 } },
		{ header: 'bytes=-10', expected: { start: 990, end: 999 } },
		{ header: 'bytes=-5000', expected: { start: 0, end: 999 } },
		{ header: 'bytes=1000-', expected: 'unsatisfiable' },
		{ header: 'bytes=-0', expected: 'unsatisfiable' },
		{ header: 'bytes=0-9,20-29', expected: undefined },
		{ header: 'bytes=200-100', expected: undefined },
		{ header: 'bytes=-', expected: undefined },
		{ header: 'items=0-9', expected: undefined },
		{ header: 'bytes=abc', expected: undefined },
		{ header: `bytes=0-${'9'.repeat(20)}`, expected: { start: 0, end: 999 } },
		{ header: `bytes=${'9'.repeat(20)}-`, expected: 'unsatisfiable' },
	])('reads $header against 1000 bytes as $expected', ({ header, expected }) => {
		expect(requestedByteRange(header, 1000)).toEqual(expected);
	});

	it('finds no satisfiable range in an empty body', () => {
		expect(requestedByteRange('bytes=0-', 0)).toBe('unsatisfiable');
	});
});

describe('ifNoneMatchMatches', () => {
	it.each([
		{ header: undefined, matches: false },
		{ header: '"other"', matches: false },
		{ header: '"tag"', matches: true },
		{ header: 'W/"tag"', matches: true },
		{ header: '"other", "tag"', matches: true },
		{ header: '*', matches: true },
	])('$header matches "tag": $matches', ({ header, matches }) => {
		expect(ifNoneMatchMatches(header, '"tag"')).toBe(matches);
	});
});

describe('rangePermitted', () => {
	it.each([
		{ ifRange: undefined, permitted: true },
		{ ifRange: '"tag"', permitted: true },
		{ ifRange: '"other"', permitted: false },
	])('If-Range $ifRange permits the range: $permitted', ({ ifRange, permitted }) => {
		expect(rangePermitted(ifRange, '"tag"')).toBe(permitted);
	});
});
