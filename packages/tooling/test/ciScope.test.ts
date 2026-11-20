import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	configBindsKeeprAccounts,
	diffRange,
	NO_LEG_WORKER_JOB,
	scope as scopeIn,
	scopeOf,
	skippedJobs,
	workerLegsOf,
} from '../scripts/ci-scope.mjs';
import { workspacePackages } from '../scripts/versioned-apps.mjs';

const packageRoot = join(import.meta.dirname, '..');

interface Package {
	name: string;
	dir: string;
	dependencies: Record<string, string>;
	devDependencies?: Record<string, string>;
	exports?: unknown;
}

const on = (...names: string[]) =>
	Object.fromEntries(names.map((name) => [`@keepr/${name}`, 'workspace:*']));

/**
 * The workspace's shape: two deployable apps on the shared layer, Stream
 * Keepr binding Keepr Accounts and on realtime, testing against the Accounts
 * Stand-in; Score Keepr, not deployable, on the engines; every app on the
 * tooling. The tooling and the engines export nothing under `test/`; the
 * shared layer exports everything, its test helpers included.
 */
const PACKAGES: Package[] = [
	{
		name: '@keepr/stream',
		dir: 'apps/stream',
		dependencies: { ...on('nuxt-layer', 'realtime'), nuxt: 'catalog:framework' },
		devDependencies: on('accounts-stand-in', 'tooling'),
	},
	{
		name: '@keepr/accounts',
		dir: 'apps/accounts',
		dependencies: on('nuxt-layer'),
		devDependencies: on('tooling'),
	},
	{
		name: '@keepr/score',
		dir: 'apps/score',
		dependencies: on('nuxt-layer', 'pairing'),
		devDependencies: on('tooling'),
	},
	{ name: '@keepr/nuxt-layer', dir: 'packages/nuxt-layer', dependencies: {} },
	{
		name: '@keepr/realtime',
		dir: 'packages/realtime',
		dependencies: {},
		exports: { './client': './src/client/index.ts' },
	},
	{
		name: '@keepr/engine-core',
		dir: 'packages/engine-core',
		dependencies: {},
		exports: { '.': './src/index.ts' },
	},
	{
		name: '@keepr/pairing',
		dir: 'packages/pairing',
		dependencies: on('engine-core'),
		devDependencies: on('testkit'),
		exports: { '.': './src/index.ts' },
	},
	{
		name: '@keepr/testkit',
		dir: 'packages/testkit',
		dependencies: {},
		exports: { '.': './src/index.ts' },
	},
	{
		name: '@keepr/tooling',
		dir: 'packages/tooling',
		dependencies: {},
		exports: { './scripts/*': './scripts/*' },
	},
	{
		name: '@keepr/accounts-stand-in',
		dir: 'packages/accounts-stand-in',
		dependencies: on('nuxt-layer'),
		exports: { './cookie': { import: './src/cookie.mjs' } },
	},
];
const WORKSPACE = new Map(PACKAGES.map((pkg) => [pkg.name, pkg]));

/** CI's project gates, by job id, in ci.yml's order. */
const STREAM_KEEPR = [
	'stream-typecheck',
	'stream-unit',
	'stream-nuxt',
	'stream-integration',
	'stream-browser',
];
const EVERY_GATE = [...STREAM_KEEPR, 'score', 'accounts', 'engines', 'shared-app-code', 'tooling'];
const EVERYTHING = { code: true, docs: false, gates: EVERY_GATE };
/** What the shared layer affects: every app and the packages beside it, not the engines or the tooling. */
const EVERY_APP = [...STREAM_KEEPR, 'score', 'accounts', 'shared-app-code'];
/** A change that affects some projects, and a document Stream Keepr's Unit suite runs no test of. */
const only = (gates: string[], docs = false) => ({ code: true, docs, gates });

describe('which gates a change runs: those checking a project it affects', () => {
	it.each([
		// Each app alone.
		["an app's own code", ['apps/stream/server/api/time.get.ts'], only(STREAM_KEEPR)],
		['Score Keepr', ['apps/score/app/pages/index.vue'], only(['score'])],
		['Keepr Accounts', ['apps/accounts/server/api/x.ts'], only(['accounts'])],
		// A package, and everything that depends on it, one through another.
		['the shared layer: every app', ['packages/nuxt-layer/server/x.ts'], only(EVERY_APP)],
		[
			'an engine: the engines and Score Keepr, through the engine between',
			['packages/engine-core/src/x.ts'],
			only(['score', 'engines']),
		],
		// Its tests import it, so a devDependency is a dependency too.
		[
			'the Accounts Stand-in: Stream Keepr, which tests against it',
			['packages/accounts-stand-in/src/standIn.ts'],
			only([...STREAM_KEEPR, 'shared-app-code']),
		],
		// What no dependent imports.
		[
			"a package's own test file: that package alone",
			['packages/nuxt-layer/test/unit/x.test.ts'],
			only(['shared-app-code']),
		],
		[
			'a test helper of a package that exports nothing under test/: that package alone',
			['packages/tooling/test/helpers/fakeGitHub.ts'],
			only(['tooling']),
		],
		[
			'a test helper of a package without exports: its dependents too',
			['packages/nuxt-layer/test/helpers/deferred.ts'],
			only(EVERY_APP),
		],
		// Read across projects without an import.
		[
			'a deploy descriptor: its app and the tooling, whose tests read it',
			['apps/accounts/deploy.jsonc'],
			only(['accounts', 'tooling']),
		],
		[
			"a Version PR's manifest: everything, since the tooling and other apps read it",
			['apps/stream/CHANGELOG.md', 'apps/stream/package.json', '.changeset/brave-owls.md'],
			EVERYTHING,
		],
		// What every project is built or checked with.
		['a tooling script', ['packages/tooling/scripts/slots.mjs'], EVERYTHING],
		// Nothing says what reads it: the lockfile, the workspace's configuration, CI and the other workflows.
		['a file in no project', ['pnpm-lock.yaml'], EVERYTHING],
		// The documentation test is among Stream Keepr's Unit suite's.
		[
			"a document beside a change the Unit suite checks: that suite's test",
			['apps/stream/test/unit/scripts/repoWiring.test.ts', 'README.md'],
			only(STREAM_KEEPR),
		],
		[
			'a document beside a change it does not: the Workspace checks run the test',
			['packages/pairing/src/x.ts', 'packages/pairing/README.md'],
			only(['score', 'engines'], true),
		],
		[
			'docs only',
			[
				'README.md',
				'apps/stream/docs/adr/0001-graphic-style-sets-reference-application-fonts-only.md',
			],
			{ code: false, docs: true, gates: [] },
		],
		[
			'editor settings and dependabot',
			['.vscode/settings.json', '.github/dependabot.yml'],
			{ code: false, docs: false, gates: [] },
		],
		['nothing it can tell', [], EVERYTHING],
	])('%s', (_case, files, expected) => {
		expect(scopeOf(files, WORKSPACE)).toEqual(expected);
	});

	it('runs everything when it cannot read the workspace to place a change in', () => {
		expect(scopeOf(['apps/score/app/pages/index.vue'], new Map())).toEqual(EVERYTHING);
	});

	// The graph is the package.json files themselves, read as the scope job reads them.
	it("in this workspace, a change to the Pairing Engine runs Score Keepr's and the Engines' gates alone", () => {
		expect(
			scopeOf(['packages/pairing/src/index.ts'], workspacePackages(join(packageRoot, '../..'))),
		).toEqual(only(['score', 'engines']));
	});
});

describe("what a merge group's own run would skip, by the names GitHub reports", () => {
	it.each([
		[
			'every gate it does not run, a matrix job by its template',
			{ gates: ['score', 'engines'], apps: [{ app: 'stream' }] },
			[
				'Stream Keepr: Typecheck',
				'Stream Keepr: Unit suite',
				'Stream Keepr: Nuxt suite',
				'Stream Keepr: Integration suite (${{ matrix.shard }}/2)',
				'Stream Keepr: Browser gates',
				'Keepr Accounts',
				'Packages: Shared app code',
				'Packages: Tooling',
			],
		],
		[
			'and the Worker job when it runs no leg',
			{ gates: EVERY_GATE, apps: [] },
			[NO_LEG_WORKER_JOB],
		],
	])('%s', (_case, group, expected) => {
		expect(skippedJobs(group)).toEqual(expected);
	});
});

const STREAM = { app: 'stream', accounts: true };
const ACCOUNTS = { app: 'accounts', accounts: false };
const ORPHAN = { app: 'orphan', accounts: false };

describe("which deployable apps' Worker legs a change runs", () => {
	const legs = (files: string[], apps = [STREAM, ACCOUNTS]) =>
		workerLegsOf(files, { apps, packages: WORKSPACE });

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
		["the tooling's manifest: every app", ['packages/tooling/package.json'], [STREAM, ACCOUNTS]],
		[
			"the tooling's tests or documents: none",
			['packages/tooling/test/ciScope.test.ts', 'packages/tooling/README.md'],
			[],
		],
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

	// A deployable app whose package it cannot read runs its leg for any change to the code.
	it.each([
		['a change to the code: its leg', ['packages/pairing/src/x.ts'], [ORPHAN]],
		['a change to a document only: none', ['docs/notes.md'], []],
	])('an app whose package it cannot read, on %s', (_case, files, expected) => {
		expect(legs(files, [STREAM, ORPHAN])).toEqual(expected);
	});
});

// What a binding is has its home in deploy/order.mjs; the scope, before any
// build, reads every block of the source configuration, not one Environment's.
describe('whether an app binds Keepr Accounts, in any Environment', () => {
	const binding = { binding: 'KEEPR_ACCOUNTS', service: 'keepr-accounts' };

	it.each([
		['at the top level', { services: [binding] }, true],
		['in one Environment only', { env: { staging: { services: [binding] } } }, true],
	])('%s', (_case, config, expected) => {
		expect(configBindsKeeprAccounts(config)).toBe(expected);
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
		testsOnly: ['apps/stream/test/time.test.ts', 'docs/second.md'],
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
				// Stream Keepr, deployable: what its Worker leg is scoped by. Its
				// descriptor names a source configuration other than wrangler.jsonc,
				// binding Keepr Accounts: the scope reads the one the descriptor names.
				commit(
					'main',
					{
						'README.md': 'chore: the base',
						'apps/stream/package.json': JSON.stringify({ name: '@keepr/stream' }),
						'apps/stream/deploy.jsonc': JSON.stringify({ worker: { source: 'worker.jsonc' } }),
						'apps/stream/worker.jsonc': JSON.stringify({
							services: [{ binding: 'KEEPR_ACCOUNTS', service: 'keepr-accounts' }],
						}),
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
		const [base, codeThenDocs, docsOnly, testsOnly] = git(
			origin,
			'rev-parse',
			'main',
			'queue/codeThenDocs',
			'queue/docsOnly',
			'queue/testsOnly',
		).split('\n') as [string, string, string, string];
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
			testsOnly: {
				base,
				head: testsOnly,
				pristine: shallowCheckout(origin, testsOnly, join(workspace, 'testsOnly')),
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

		expect(output).toBe(
			'code=true\ndocs=false\ngates=["stream-typecheck","stream-unit","stream-nuxt","stream-integration","stream-browser"]\napps=[{"app":"stream","accounts":true}]\n',
		);
		expect(log).toMatch(/Could not list the records.*HTTP 502/);
		expect(log).toMatch(/running the gates/);
	});

	it('a merge group whose last PR is docs-only still runs the gates its first PR needs', () => {
		const { checkout, base, head } = mergeGroup('codeThenDocs');

		expect(
			scope(checkout, 'merge_group', {
				merge_group: { base_sha: base, head_sha: head },
			}).output,
		).toBe(
			'code=true\ndocs=false\ngates=["stream-typecheck","stream-unit","stream-nuxt","stream-integration","stream-browser"]\napps=[{"app":"stream","accounts":true}]\n',
		);
	});

	it('a merge group of docs-only PRs skips the code gates and checks the docs', () => {
		const { checkout, base, head } = mergeGroup('docsOnly');

		expect(
			scope(checkout, 'merge_group', {
				merge_group: { base_sha: base, head_sha: head },
			}).output,
		).toBe('code=false\ndocs=true\ngates=[]\napps=[]\n');
	});

	// The checkout holds Stream Keepr alone, so no change affects what the other gates check.
	// GitHub holds a PR run of the group's tree; ci-reuse.mjs decides whether it verifies the group.
	it.each<[string, keyof typeof QUEUED, string[]]>([
		[
			"tests-only skips the other projects' gates and the Worker job",
			'testsOnly',
			[
				'Score Keepr',
				'Keepr Accounts',
				'Packages: Engines',
				'Packages: Shared app code',
				'Packages: Tooling',
				NO_LEG_WORKER_JOB,
			],
		],
		[
			"shipping in an app skips only the other projects' gates",
			'codeThenDocs',
			[
				'Score Keepr',
				'Keepr Accounts',
				'Packages: Engines',
				'Packages: Shared app code',
				'Packages: Tooling',
			],
		],
	])(
		'a merge group %s, and asks the reuse check for a run that skipped no more',
		async (_case, group, skipped) => {
			const { checkout, base, head } = mergeGroup(group);
			const asked: (readonly string[])[] = [];

			await expect(
				scopeIn({
					eventName: 'merge_group',
					event: { merge_group: { base_sha: base, head_sha: head } },
					cwd: checkout,
					verifiedRun: async (_head: string, group: { skipped: readonly string[] }) => {
						asked.push(group.skipped);
						return { id: 1, url: 'https://ci.example/runs/1' };
					},
				}),
			).resolves.toEqual({
				code: false,
				docs: false,
				gates: [],
				apps: [],
				verifiedBy: 'https://ci.example/runs/1',
			});
			expect(asked).toEqual([skipped]);
		},
	);

	it('a base it cannot fetch runs everything', () => {
		const { checkout, head } = mergeGroup('docsOnly');

		expect(
			scope(checkout, 'merge_group', {
				merge_group: {
					base_sha: 'f'.repeat(40),
					head_sha: head,
				},
			}).output,
		).toBe(
			'code=true\ndocs=false\ngates=["stream-typecheck","stream-unit","stream-nuxt","stream-integration","stream-browser","score","accounts","engines","shared-app-code","tooling"]\napps=[{"app":"stream","accounts":true}]\n',
		);
	});
});
