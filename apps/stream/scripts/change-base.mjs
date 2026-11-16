/**
 * Where this checkout's change is measured from.
 *
 * `pnpm verify:quick` checks a change in proportion to it (README § Testing):
 * it runs the tests whose imports reach a file that differs from here. CI is
 * the full gate, so the answer has to be fast rather than exhaustive.
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

/** Where a branch is measured from, in order of preference. */
const MAIN_REFS = ['origin/main', 'main'];

function gitIn(cwd) {
	return (args) =>
		execFileSync('git', args, {
			cwd,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		});
}

/**
 * The ref this branch is measured against: the first of `origin/main` and
 * `main` it shares history with. A stale `origin/main` only widens the answer,
 * since the comparison is against the commit the two have in common.
 *
 * @returns {{ ref: string, commit: string } | undefined} `undefined` when there is no such ref
 */
export function changeBase({ cwd = repositoryRoot, git = gitIn(cwd) } = {}) {
	for (const ref of MAIN_REFS) {
		try {
			return {
				ref,
				commit: git(['merge-base', 'HEAD', ref]).trim(),
			};
		} catch {
			// No such ref, or no history in common: try the next.
		}
	}
	return undefined;
}
