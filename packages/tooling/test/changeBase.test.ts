import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { afterEach, describe, expect, it } from 'vitest';
import { changeBase } from '../scripts/change-base.mjs';

/** Against real git: a local "origin" and a clone of it on a branch. Nothing remote. */
describe("where a checkout's change is measured from", () => {
	const directories: string[] = [];

	afterEach(() => {
		for (const directory of directories.splice(0))
			rmSync(directory, { recursive: true, force: true });
	});

	function git(cwd: string, ...args: string[]) {
		return execFileSync('git', args, {
			cwd,
			encoding: 'utf8',
			env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
		}).trim();
	}

	function commit(cwd: string, file: string, message: string) {
		mkdirSync(join(cwd, dirname(file)), { recursive: true });
		writeFileSync(join(cwd, file), `${message}\n`);
		git(cwd, 'add', '.');
		git(
			cwd,
			'-c',
			'user.name=test',
			'-c',
			'user.email=test@example.invalid',
			'commit',
			'-q',
			'-m',
			message,
		);
	}

	function repository(prefix: string) {
		const directory = mkdtempSync(join(tmpdir(), prefix));
		directories.push(directory);
		return directory;
	}

	it('is where the branch left origin/main, however far main has moved since', () => {
		const origin = repository('change-base-origin-');
		git(origin, 'init', '-q', '-b', 'main');
		commit(origin, 'server/kept.ts', 'chore: the base');
		const checkout = repository('change-base-checkout-');
		git(checkout, 'clone', '-q', `file://${origin}`, '.');
		git(checkout, 'switch', '-q', '-c', 'fix/branch');
		const left = git(checkout, 'rev-parse', 'HEAD');
		commit(origin, 'docs/later.md', 'docs: main moves on');
		git(checkout, 'fetch', '-q', 'origin');
		commit(checkout, 'app/committed.vue', 'fix: a committed change');

		expect(changeBase({ cwd: checkout })).toEqual({ ref: 'origin/main', commit: left });
	});

	it('is the local main where there is no origin', () => {
		const alone = repository('change-base-local-');
		git(alone, 'init', '-q', '-b', 'main');
		commit(alone, 'README.md', 'chore: the base');
		const left = git(alone, 'rev-parse', 'HEAD');
		git(alone, 'switch', '-q', '-c', 'fix/branch');
		commit(alone, 'app/committed.vue', 'fix: a committed change');

		expect(changeBase({ cwd: alone })).toEqual({ ref: 'main', commit: left });
	});

	it('cannot tell where there is no main to measure from', () => {
		const alone = repository('change-base-alone-');
		git(alone, 'init', '-q', '-b', 'work');
		commit(alone, 'README.md', 'chore: no main anywhere');

		expect(changeBase({ cwd: alone })).toBeUndefined();
	});
});
