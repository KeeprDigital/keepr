import { describe, expect, it } from 'vitest';
import {
	formatClockTime,
	formatCountdownTime,
	normalizeTimeInput,
	parseTimeInput,
} from '../../../shared/utils/clockTime';

describe('formatClockTime', () => {
	it.each([
		[0, '0:00'],
		[30_000, '0:30'],
		[61_000, '1:01'],
		[150_000, '2:30'],
		[1_999, '0:01'],
		[3_600_000, '1:00:00'],
		[3_661_000, '1:01:01'],
	])('formats %i ms as %s', (ms, expected) => {
		expect(formatClockTime(ms)).toBe(expected);
	});
});

// A countdown rounds the time remaining up: it reads its full duration through
// its first second and 0:00 only once nothing remains (ADR-0078).
describe('formatCountdownTime', () => {
	it.each([
		[3_000_000, '50:00'],
		[2_999_999, '50:00'],
		[2_999_001, '50:00'],
		[2_999_000, '49:59'],
		[3_599_001, '1:00:00'],
		[59_001, '1:00'],
		[1_001, '0:02'],
		[1_000, '0:01'],
		[1, '0:01'],
		[0, '0:00'],
		[-1, '0:00'],
	])('formats %i ms remaining as %s', (ms, expected) => {
		expect(formatCountdownTime(ms)).toBe(expected);
	});
});

describe('normalizeTimeInput', () => {
	it.each([
		['12:34', '12:34'],
		['1:23:45', '1:23:45'],
		['75:00', '75:00'],
		['5', '5:00'],
		['45', '45:00'],
		['530', '05:30'],
		['1234', '12:34'],
		['12345', '1:23:45'],
		['123456', '12:34:56'],
		['12.34', '12:34'],
	])('reads %j as %s', (input, expected) => {
		expect(normalizeTimeInput(input)).toBe(expected);
	});

	it.each(['', '   ', '1234567', '5:60', '5:99', '1:23:99', '1:60:00', '1:99:00'])(
		'refuses %j',
		(input) => {
			expect(normalizeTimeInput(input)).toBeNull();
		},
	);
});

describe('normalizeTimeInput and parseTimeInput agree', () => {
	it('accepts every string normalizeTimeInput returns as canonical', () => {
		const inputs: string[] = [
			'5:',
			':5',
			'5::5',
			' 12:34 ',
			'0:00',
			'00:00',
			'005:009',
			'abc',
			'5.99',
			'1:23:45:67',
			'99999999999999999999:00',
		];
		for (let minutes = 0; minutes <= 70; minutes += 1) {
			for (let seconds = 0; seconds <= 70; seconds += 7) {
				inputs.push(`${minutes}:${seconds}`);
				inputs.push(`${minutes}:${String(seconds).padStart(2, '0')}`);
			}
		}
		for (const hours of [0, 1, 12, 99]) {
			for (let minutes = 0; minutes <= 70; minutes += 7) {
				for (let seconds = 0; seconds <= 70; seconds += 7) {
					inputs.push(`${hours}:${minutes}:${seconds}`);
				}
			}
		}
		for (const digits of [
			'0',
			'9',
			'59',
			'60',
			'99',
			'099',
			'559',
			'599',
			'1234',
			'1299',
			'5999',
			'12345',
			'19999',
			'123456',
			'129999',
			'1234567',
		]) {
			inputs.push(digits);
		}

		for (const input of inputs) {
			const normalized = normalizeTimeInput(input);
			if (normalized !== null) {
				expect(
					parseTimeInput(normalized),
					`normalizeTimeInput(${JSON.stringify(input)}) -> ${JSON.stringify(normalized)} must be parseable`,
				).not.toBeNull();
			}
		}
	});
});

describe('parseTimeInput', () => {
	it.each([
		['2:30', 150_000],
		['1:00:00', 3_600_000],
		['45', 2_700_000],
		['', null],
		['abc', null],
	])('reads %j as %s ms', (input, expected) => {
		expect(parseTimeInput(input)).toBe(expected);
	});
});
