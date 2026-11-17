import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bindsKeeprAccounts, diffRange, scopeOf, workerLegsOf } from '../scripts/ci-scope.mjs';

const packageRoot = join(import.meta.dirname, '..');

const EVERYTHING = { code: true, docs: false };

describe('what a change can affect', () => {
	it.each([
		[
			'docs only',
			[
				'README.md',
				'apps/stream/docs/adr/0001-graphic-style-sets-reference-application-fonts-only.md',
			],
			{ code: false, docs: true },
		],
		[
			'editor settings and dependabot',
			['.vscode/settings.json', '.github/dependabot.yml'],
			{ code: false, docs: false },
		],
		[
			'docs beside editor settings',
			['.vscode/settings.json', 'docs/notes.md'],
			{ code: false, docs: true },
		],
		// Each is held by wiring tests, which run only if CI does.
		[
			'another workflow',
			[
				'.github/workflows/deploy.yml',
				'.github/workflows/pr-title.yml',
				'.github/workflows/release.yml',
			],
			EVERYTHING,
		],
		// The code gates lint every document and run the documentation test themselves.
		[
			'tests and docs',
			['apps/stream/test/unit/scripts/repoWiring.test.ts', 'README.md'],
			EVERYTHING,
		],
		['server code', ['apps/stream/server/api/time.get.ts'], EVERYTHING],
		['a script', ['packages/tooling/scripts/ci-scope.mjs'], EVERYTHING],
		['CI itself', ['.github/workflows/ci.yml'], EVERYTHING],
		['the shared setup action', ['.github/actions/setup/action.yml'], EVERYTHING],
		[
			'the version bump of a Version PR',
			['apps/stream/CHANGELOG.md', 'apps/stream/package.json', '.changeset/brave-owls.md'],
			EVERYTHING,
		],
	])('%s', (_case, files, expected) => {
		expect(scopeOf(files)).toEqual(expected);
	});

	it('runs everything when it cannot tell what changed', () => {
		expect(scopeOf([])).toEqual(EVERYTHING);
	});
});

interface Package {
	name: string;
	dir: string;
	dependencies: Record<string, string>;
}

/**
 * Two deployable apps on the shared layer, one binding Keepr Accounts; Score
 * Keepr, not deployable, alone on the Pairing Engine.
 */
const PACKAGES: Package[] = [
	{
		name: '@keepr/stream',
		dir: 'apps/stream',
		dependencies: { '@keepr/nuxt-layer': 'workspace:*', nuxt: 'catalog:framework' },
	},
	{
		name: '@keepr/accounts',
		dir: 'apps/accounts',
		dependencies: { '@keepr/nuxt-layer': 'workspace:*' },
	},
	{ name: '@keepr/score', dir: 'apps/score', dependencies: { '@keepr/pairing': 'workspace:*' } },
	{ name: '@keepr/nuxt-layer', dir: 'packages/nuxt-layer', dependencies: {} },
	{ name: '@keepr/pairing', dir: 'packages/pairing', dependencies: {} },
	{ name: '@keepr/tooling', dir: 'packages/tooling', dependencies: {} },
	{
		name: '@keepr/accounts-stand-in',
		dir: 'packages/accounts-stand-in',
		dependencies: { '@keepr/nuxt-layer': 'workspace:*' },
	},
];
const STREAM = { app: 'stream', accounts: true };
const ACCOUNTS = { app: 'accounts', accounts: false };

describe("which deployable apps' Worker legs a change runs", () => {
	const legs = (files: string[], apps = [STREAM, ACCOUNTS]) =>
		workerLegsOf(files, { apps, packages: new Map(PACKAGES.map((pkg) => [pkg.name, pkg])) });

	it.each([
		[
			'the shared layer: every app that ships it',
			['packages/nuxt-layer/server/x.ts'],
			[STREAM, ACCOUNTS],
		],
		["only an app's tests: none", ['apps/stream/test/unit/x.test.ts'], []],
		["an app's own code: that app", ['apps/accounts/server/api/x.ts'], [ACCOUNTS]],
		['a package only an undeployable app ships: none', ['packages/pairing/src/x.ts'], []],
		['another workflow: none', ['.github/workflows/deploy.yml'], []],
		// What builds every leg, though no app ships it.
		['CI itself: every app', ['.github/workflows/ci.yml'], [STREAM, ACCOUNTS]],
		['the setup action: every app', ['.github/actions/setup/action.yml'], [STREAM, ACCOUNTS]],
		['the tooling: every app', ['packages/tooling/scripts/deploy/cli.mjs'], [STREAM, ACCOUNTS]],
		['the root manifest: every app', ['package.json'], [STREAM, ACCOUNTS]],
		['the compiler options: every app', ['tsconfig.base.json'], [STREAM, ACCOUNTS]],
		[
			'the Accounts Stand-in: each app it stands in for',
			['packages/accounts-stand-in/src/worker.ts'],
			[STREAM],
		],
		['nothing it can tell: every app', [], [STREAM, ACCOUNTS]],
	])('%s', (_case, files, expected) => {
		expect(legs(files)).toEqual(expected);
	});

	it('runs the leg of a deployable app whose package it cannot read for any change to the code', () => {
		const orphan = { app: 'orphan', accounts: false };

		expect(legs(['packages/pairing/src/x.ts'], [STREAM, orphan])).toEqual([orphan]);
		expect(legs(['docs/notes.md'], [STREAM, orphan])).toEqual([]);
	});
});

describe('whether an app binds Keepr Accounts', () => {
	const binding = { binding: 'KEEPR_ACCOUNTS', service: 'keepr-accounts' };

	it.each([
		['at the top level', { services: [binding] }, true],
		['in one Environment only', { env: { staging: { services: [binding] } } }, true],
		['another service only', { services: [{ binding: 'OTHER', service: 'other' }] }, false],
		['no service', { name: 'stream-keepr' }, false],
	])('%s', (_case, config, expected) => {
		expect(bindsKeeprAccounts(config)).toBe(expected);
	});
});

describe('which revisions the change is measured between', () => {
	it("a PR: its test merge commit against that commit's first parent, the base", () => {
		expect(
			diffRange('pull_request', {
				pull_request: { draft: false },
			}),
		).toEqual({ base: 'HEAD^1', head: 'HEAD' });
	});

	it("a merge group: the queue's base against the combined tree it would land, never HEAD^1", () => {
		// A group of several squashed PRs has one commit per PR above its base, so
		// HEAD^1 would measure only the last of them.
		const event = {
			merge_group: {
				base_sha: 'a'.repeat(40),
				head_sha: 'b'.repeat(40),
				head_ref: 'refs/heads/gh-readonly-queue/main/pr-1-x',
				base_ref: 'refs/heads/main',
			},
		};

		expect(diffRange('merge_group', event)).toEqual({
			base: 'a'.repeat(40),
			head: 'b'.repeat(40),
			fetch: 'a'.repeat(40),
		});
	});

	it.each([
		[
			'a merge group without a base',
			'merge_group',
			{
				merge_group: {
					head_sha: 'b'.repeat(40),
				},
			},
		],
		[
			'a merge group whose base is not a commit id',
			'merge_group',
			{
				merge_group: {
					base_sha: 'main; rm -rf /',
					head_sha: 'b'.repeat(40),
				},
			},
		],
		[
			'a push',
			'push',
			{
				after: 'b'.repeat(40),
			},
		],
		['a manual run', 'workflow_dispatch', {}],
	])('nothing to measure against for %s: run everything', (_case, eventName, event) => {
		expect(diffRange(eventName, event)).toBeUndefined();
	});
});

/**
 * The command line against real git: a local "origin" and a checkout shaped
 * like CI's (`fetch-depth: 2` of the event's revision), copied for each case
 * because the command fetches into it. Nothing remote.
 */
describe("the scope job's command line", () => {
	/** The two squashed PRs each merge group queues above main, by the file each changes. */
	const QUEUED = {
		codeThenDocs: ['apps/stream/server/api/time.get.ts', 'docs/second.md'],
		docsOnly: ['docs/first.md', 'docs/second.md'],
	} as const;

	let workspace: string;
	/** Per group: the main revision it lands on, its head, and its checkout as first fetched. */
	let groups: Record<keyof typeof QUEUED, { base: string; head: string; pristine: string }>;

	const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };

	function git(cwd: string, ...args: string[]) {
		return execFileSync('git', args, { cwd, encoding: 'utf8', env: gitEnv }).trim();
	}

	/**
	 * A `git fast-import` commit adding `files` to `branch`, which forks from
	 * `from` when new; each holds `message` unless given its content.
	 */
	function commit(
		branch: string,
		files: string | Record<string, string>,
		message: string,
		from?: string,
	) {
		const contents = typeof files === 'string' ? { [files]: message } : files;
		return [
			`commit refs/heads/${branch}`,
			'committer test <test@example.invalid> 1700000000 +0000',
			'data <<END',
			message,
			'END',
			...(from ? [`from refs/heads/${from}`] : []),
			...Object.entries(contents).flatMap(([file, content]) => [
				`M 100644 inline ${file}`,
				'data <<END',
				content,
				'END',
			]),
			'',
		].join('\n');
	}

	/** A checkout as `actions/checkout` leaves it: `head` and its parent, the base further back. */
	function shallowCheckout(origin: string, head: string, checkout: string) {
		git(workspace, 'init', '-q', checkout);
		git(checkout, 'remote', 'add', 'origin', `file://${origin}`);
		git(checkout, 'fetch', '-q', '--no-tags', '--depth=2', 'origin', head);
		git(checkout, 'checkout', '-q', head);
		return checkout;
	}

	beforeAll(() => {
		workspace = mkdtempSync(join(tmpdir(), 'ci-scope-'));
		const origin = join(workspace, 'origin');
		git(workspace, 'init', '-q', '--bare', '-b', 'main', origin);
		// One git process writes main and both queues above it.
		execFileSync('git', ['fast-import', '--quiet'], {
			cwd: origin,
			env: gitEnv,
			input: [
				// Stream Keepr, deployable: what its Worker leg is scoped by.
				commit(
					'main',
					{
						'README.md': 'chore: the base',
						'apps/stream/package.json': JSON.stringify({ name: '@keepr/stream' }),
						'apps/stream/deploy.jsonc': '{}',
					},
					'chore: the base',
				),
				commit('main', 'docs/notes.md', 'docs: main moves on'),
				...Object.entries(QUEUED).flatMap(([group, [first, second]]) => [
					commit(`queue/${group}`, first, 'fix(server): the first queued PR', 'main'),
					commit(`queue/${group}`, second, 'docs: the second queued PR'),
				]),
			].join('\n'),
		});
		const [base, codeThenDocs, docsOnly] = git(
			origin,
			'rev-parse',
			'main',
			'queue/codeThenDocs',
			'queue/docsOnly',
		).split('\n') as [string, string, string];
		groups = {
			codeThenDocs: {
				base,
				head: codeThenDocs,
				pristine: shallowCheckout(origin, codeThenDocs, join(workspace, 'codeThenDocs')),
			},
			docsOnly: {
				base,
				head: docsOnly,
				pristine: shallowCheckout(origin, docsOnly, join(workspace, 'docsOnly')),
			},
		};
	});

	afterAll(() => {
		rmSync(workspace, { recursive: true, force: true });
	});

	/** A main revision with a merge group of two squashed PRs above it, in a checkout of this case's own. */
	function mergeGroup(group: keyof typeof QUEUED) {
		const { base, head, pristine } = groups[group];
		const checkout = join(mkdtempSync(join(workspace, 'job-')), 'checkout');
		cpSync(pristine, checkout, { recursive: true });
		return { checkout, base, head };
	}

	/** No GitHub to read unless a case supplies one: CI's own test jobs carry GITHUB_REPOSITORY. */
	const offline = { GH_TOKEN: '', GITHUB_REPOSITORY: '', GITHUB_REPOSITORY_ID: '' };

	function scope(
		cwd: string,
		eventName: string,
		event: unknown,
		env: Record<string, string> = offline,
	) {
		const eventPath = join(dirname(cwd), 'event.json');
		const output = join(dirname(cwd), 'output');
		writeFileSync(eventPath, JSON.stringify(event));
		writeFileSync(output, '');
		const result = spawnSync(process.execPath, [join(packageRoot, 'scripts/ci-scope.mjs')], {
			cwd,
			encoding: 'utf8',
			env: {
				...process.env,
				...env,
				GITHUB_EVENT_NAME: eventName,
				GITHUB_EVENT_PATH: eventPath,
				GITHUB_OUTPUT: output,
				GIT_CONFIG_GLOBAL: '/dev/null',
				GIT_CONFIG_NOSYSTEM: '1',
			},
		});
		expect(result.status, result.stderr).toBe(0);
		return {
			output: readFileSync(output, 'utf8'),
			log: result.stdout,
		};
	}

	it("a merge group that cannot read GitHub for a PR run's record is scoped as usual, never skipped", () => {
		const { checkout, base, head } = mergeGroup('codeThenDocs');
		const bin = join(dirname(checkout), 'bin');
		mkdirSync(bin);
		writeFileSync(join(bin, 'gh'), '#!/bin/sh\necho "HTTP 502: Bad Gateway" >&2\nexit 1\n', {
			mode: 0o755,
		});

		const { output, log } = scope(
			checkout,
			'merge_group',
			{
				merge_group: { base_sha: base, head_sha: head },
			},
			{
				GH_TOKEN: 'test-token',
				GITHUB_REPOSITORY: 'KeeprDigital/stream-keepr',
				GITHUB_REPOSITORY_ID: '1',
				PATH: `${bin}:${process.env.PATH}`,
			},
		);

		expect(output).toBe('code=true\ndocs=false\napps=[{"app":"stream","accounts":false}]\n');
		expect(log).toMatch(/Could not list the records.*HTTP 502/);
		expect(log).toMatch(/running the gates/);
	});

	it('a merge group whose last PR is docs-only still runs the gates its first PR needs', () => {
		const { checkout, base, head } = mergeGroup('codeThenDocs');

		expect(
			scope(checkout, 'merge_group', {
				merge_group: { base_sha: base, head_sha: head },
			}).output,
		).toBe('code=true\ndocs=false\napps=[{"app":"stream","accounts":false}]\n');
	});

	it('a merge group of docs-only PRs skips the code gates and checks the docs', () => {
		const { checkout, base, head } = mergeGroup('docsOnly');

		expect(
			scope(checkout, 'merge_group', {
				merge_group: { base_sha: base, head_sha: head },
			}).output,
		).toBe('code=false\ndocs=true\napps=[]\n');
	});

	it('a base it cannot fetch runs everything', () => {
		const { checkout, head } = mergeGroup('docsOnly');

		expect(
			scope(checkout, 'merge_group', {
				merge_group: {
					base_sha: 'f'.repeat(40),
					head_sha: head,
				},
			}).output,
		).toBe('code=true\ndocs=false\napps=[{"app":"stream","accounts":false}]\n');
	});
});
