import { execFileSync } from 'node:child_process';
import { mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { afterEach, describe, expect, it } from 'vitest';
import { changedFiles, quickPlan, WORKSPACE_CHECKED_ENV } from '../scripts/verify-quick.mjs';
import { workspacePackages } from '../scripts/versioned-apps.mjs';

const on = (...names: string[]) =>
	Object.fromEntries(names.map((name) => [`@keepr/${name}`, 'workspace:*']));
const QUICK = { 'verify:quick': 'x', typecheck: 'x', test: 'x' };
const BOTH = { typecheck: 'x', test: 'x' };

/**
 * Two apps with a quick gate of their own, one on realtime; realtime with a
 * typecheck and tests; a package with tests and no typecheck.
 */
const WORKSPACE = new Map(
	[
		{
			name: '@keepr/stream',
			dir: 'apps/stream',
			dependencies: on('realtime'),
			scripts: QUICK,
		},
		{ name: '@keepr/accounts', dir: 'apps/accounts', dependencies: {}, scripts: QUICK },
		{ name: '@keepr/realtime', dir: 'packages/realtime', dependencies: {}, scripts: BOTH },
		{ name: '@keepr/testkit', dir: 'packages/testkit', dependencies: {}, scripts: { test: 'x' } },
	].map((pkg) => [pkg.name, pkg]),
);

const labels = (changed: string[] | undefined, packages = WORKSPACE) =>
	quickPlan(changed, packages).steps.map((step) => step.label);

describe('what a root verify:quick runs: the quick gates of each project the change affects', () => {
	it.each([
		[
			"an app's own code: its verify:quick alone",
			['apps/stream/server/api/x.ts'],
			['changesets', '@keepr/stream verify:quick', 'lint'],
		],
		[
			"a package without a quick gate: its typecheck and tests, before its dependents'",
			['packages/realtime/src/x.ts'],
			[
				'changesets',
				'@keepr/realtime typecheck',
				'@keepr/realtime test',
				'@keepr/stream verify:quick',
				'lint',
			],
		],
		[
			'a package with no typecheck: its tests alone',
			['packages/testkit/src/x.ts'],
			['changesets', '@keepr/testkit test', 'lint'],
		],
		['a document: no project', ['apps/stream/README.md'], ['changesets', 'lint']],
		[
			'no main to measure from: every project',
			undefined,
			[
				'changesets',
				'@keepr/realtime typecheck',
				'@keepr/realtime test',
				'@keepr/testkit test',
				'@keepr/accounts verify:quick',
				'@keepr/stream verify:quick',
				'lint',
			],
		],
	])('%s', (_case, changed, expected) => {
		expect(labels(changed)).toEqual(expected);
	});

	it("runs each project's gate in it, telling it the root checks the changesets and lints", () => {
		const step = quickPlan(['apps/stream/x.ts'], WORKSPACE).steps[1];

		expect(step?.command).toEqual(['pnpm', '--filter', '@keepr/stream', 'run', 'verify:quick']);
		expect(step?.env).toEqual({ [WORKSPACE_CHECKED_ENV]: '1' });
	});

	// The graph is the package.json files themselves.
	it("in this workspace, a change to realtime runs realtime's gates and Stream Keepr's, and no other", () => {
		expect(
			quickPlan(
				['packages/realtime/src/protocol.ts'],
				workspacePackages(join(import.meta.dirname, '../../..')),
			).projects,
		).toEqual(['@keepr/realtime', '@keepr/stream']);
	});
});

/** Against real git: a repository with a commit to measure from. Nothing remote. */
describe('which files a checkout changes', () => {
	const directories: string[] = [];

	afterEach(() => {
		for (const directory of directories.splice(0))
			rmSync(directory, { recursive: true, force: true });
	});

	it('takes in what it committed, staged, left unstaged or untracked, and both ends of a rename', () => {
		const cwd = mkdtempSync(join(tmpdir(), 'verify-quick-'));
		directories.push(cwd);
		const git = (args: string[]) =>
			execFileSync('git', args, {
				cwd,
				encoding: 'utf8',
				env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
			});
		const commit = (message: string) =>
			git([
				'-c',
				'user.name=test',
				'-c',
				'user.email=test@example.invalid',
				'commit',
				'-qam',
				message,
			]);
		git(['init', '-q']);
		for (const file of ['moved', 'staged', 'unstaged', 'untouched'])
			writeFileSync(join(cwd, file), file);
		git(['add', '.']);
		commit('base');
		const base = git(['rev-parse', 'HEAD']).trim();
		writeFileSync(join(cwd, 'committed'), 'committed');
		git(['add', 'committed']);
		commit('on the branch');
		renameSync(join(cwd, 'moved'), join(cwd, 'renamed'));
		writeFileSync(join(cwd, 'staged'), 'changed');
		git(['add', '-A', 'staged', 'moved', 'renamed']);
		writeFileSync(join(cwd, 'unstaged'), 'changed');
		writeFileSync(join(cwd, 'untracked'), 'new');

		expect(changedFiles(git, base).toSorted()).toEqual([
			'committed',
			'moved',
			'renamed',
			'staged',
			'unstaged',
			'untracked',
		]);
	});
});
