import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

import { parseScenario, type Scenario } from './scenario.ts';

const INPUT = '.scenario.txt';
const OUTPUT = '.expected.txt';

/** How the run treats snapshots: `all` under `-u`, `new` locally, `none` on CI. */
export type UpdateMode = 'all' | 'new' | 'none';

/**
 * Turns every `*.scenario.txt` file in a folder into a test. `run` returns the engine's answer
 * as text, which is compared with the `*.expected.txt` file beside it.
 *
 * A scenario with no expected file fails. Run the tests with `-u` to record a new one, or to
 * re-record after an intended change, and review the diff.
 */
export function scenarioSuite(folder: URL, run: (scenario: Scenario) => string): void {
	const directory = fileURLToPath(folder);
	const names = readdirSync(directory)
		.filter((file) => file.endsWith(INPUT))
		.map((file) => file.slice(0, -INPUT.length))
		.sort();

	if (names.length === 0) {
		throw new Error(`No ${INPUT} files in ${directory}`);
	}

	for (const name of names) {
		test(name, async () => {
			const expected = join(directory, name + OUTPUT);
			requireExpected(expected, expect.getState().snapshotState.snapshotUpdateState);
			const scenario = parseScenario(readFileSync(join(directory, name + INPUT), 'utf8'));
			await expect(`${run(scenario)}\n`).toMatchFileSnapshot(expected);
		});
	}
}

/** Throws when a scenario's expected answer is missing, unless this run records answers (`-u`). */
export function requireExpected(path: string, mode: UpdateMode): void {
	if (mode !== 'all' && !existsSync(path)) {
		throw new Error(
			`${path} is missing. Run the tests with -u to record it, then review what was written.`,
		);
	}
}
