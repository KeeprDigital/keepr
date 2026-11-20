import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import { requireExpected, type UpdateMode } from './suite.ts';

const missing = fileURLToPath(new URL('./no-such.expected.txt', import.meta.url));
const present = fileURLToPath(import.meta.url);

/** What `requireExpected` does: lets the run go on, or refuses with the way to record. */
const outcome = (path: string, mode: UpdateMode): string => {
	try {
		requireExpected(path, mode);
		return 'allowed';
	} catch (error) {
		const message = (error as Error).message;
		return message ===
			`${path} is missing. Run the tests with -u to record it, then review what was written.`
			? 'refused'
			: message;
	}
};

describe('requireExpected', () => {
	// A missing answer is only ever written by an explicit re-record.
	test.each<[string, string, UpdateMode, string]>([
		['missing, local run', missing, 'new', 'refused'],
		['missing, recording with -u', missing, 'all', 'allowed'],
		['present, local run', present, 'new', 'allowed'],
	])('%s', (_, path, mode, expected) => {
		expect(outcome(path, mode)).toBe(expected);
	});
});
