import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkChange } from '../scripts/changeset-check.mjs';

const changeset = (releases: Record<string, string>) =>
	`---\n${Object.entries(releases)
		.map(([name, bump]) => `"${name}": ${bump}`)
		.join('\n')}\n---\n\nWhat changed.\n`;

const EMPTY = '---\n---\n';

interface Package {
	name: string;
	dir: string;
	version?: string;
	dependencies: Record<string, string>;
}

/**
 * A workspace shaped like Keepr's: Stream Keepr versioned on the shared layer,
 * which runs on the engine core; Score Keepr ignored on the Pairing Engine.
 */
const PACKAGES: Package[] = [
	{
		name: '@keepr/stream',
		dir: 'apps/stream',
		version: '1.6.0',
		dependencies: { '@keepr/nuxt-layer': 'workspace:*', nuxt: 'catalog:framework' },
	},
	{ name: '@keepr/score', dir: 'apps/score', dependencies: { '@keepr/pairing': 'workspace:*' } },
	{
		name: '@keepr/nuxt-layer',
		dir: 'packages/nuxt-layer',
		dependencies: { '@keepr/engine-core': 'workspace:*' },
	},
	{ name: '@keepr/engine-core', dir: 'packages/engine-core', dependencies: {} },
	{
		name: '@keepr/pairing',
		dir: 'packages/pairing',
		version: '0.0.0',
		dependencies: { '@keepr/engine-core': 'workspace:*' },
	},
	{ name: '@keepr/tooling', dir: 'packages/tooling', dependencies: {} },
];
const IGNORED = ['@keepr/score', '@keepr/pairing'];

function check(
	changed: string[],
	changesets: Record<string, string> = {},
	{ packages = PACKAGES, ignored = IGNORED } = {},
) {
	return checkChange({
		changed: [...changed, ...Object.keys(changesets)],
		changesets: Object.entries(changesets).map(([file, text]) => ({ file, text })),
		packages: new Map(packages.map((pkg) => [pkg.name, pkg])),
		ignored: new Set(ignored),
	});
}

describe("an app's shipped code", () => {
	it.each([
		['its own code', 'apps/stream/server/api/time.get.ts'],
		['a package it depends on', 'packages/nuxt-layer/src/index.ts'],
		['a package reached through another', 'packages/engine-core/src/index.ts'],
		['the lockfile, for every app', 'pnpm-lock.yaml'],
		// What builds every Worker leg (ci-scope.mjs) builds every Release.
		['the root manifest, pinning Node and pnpm', 'package.json'],
		["the packages' compiler options", 'tsconfig.base.json'],
	])('includes %s', (_case, file) => {
		const [problem] = check([file]);

		expect(problem).toMatch(/^@keepr\/stream ships this change, and no changeset names it/);
		expect(problem).toContain(`  ${file}`);
	});

	it.each([
		['its tests', 'apps/stream/test/unit/time.test.ts'],
		['its docs', 'apps/stream/docs/diagram.svg'],
		['its Markdown', 'packages/nuxt-layer/README.md'],
		['a package it only develops with', 'packages/tooling/scripts/slots.mjs'],
		['an ignored app, and what only it runs on', 'packages/pairing/src/index.ts'],
		['a workflow', '.github/workflows/ci.yml'],
	])('leaves out %s', (_case, file) => {
		expect(check([file])).toEqual([]);
	});

	it('lists the first five files and counts the rest', () => {
		const files = Array.from({ length: 7 }, (_, n) => `apps/stream/server/${n}.ts`);

		expect(check(files)[0]).toContain('  apps/stream/server/4.ts\n  … and 2 more\n');
	});
});

describe('what a changeset settles', () => {
	const SHIPPED = 'packages/nuxt-layer/src/index.ts';

	it.each([
		['one naming the app', { '.changeset/a.md': changeset({ '@keepr/stream': 'patch' }) }],
		['an empty one', { '.changeset/a.md': EMPTY }],
	])('%s passes the change', (_case, changesets) => {
		expect(check([SHIPPED], changesets)).toEqual([]);
	});

	it.each([
		[
			'an ignored app',
			changeset({ '@keepr/score': 'minor' }),
			'@keepr/score, which is not released',
		],
		['a bump that is none of the three', changeset({ '@keepr/stream': 'huge' }), 'the bump "huge"'],
		['no front matter', 'Just prose.\n', 'is not a changeset'],
	])('refuses one naming %s', (_case, text, message) => {
		expect(check([SHIPPED], { '.changeset/odd.md': text }).join('\n')).toContain(message);
	});
});

describe('only an app carries a version Changesets reads', () => {
	it.each<[string, Package[], string]>([
		[
			'a versioned app with no version',
			PACKAGES.map(({ version, ...pkg }) =>
				pkg.name === '@keepr/stream' || !version ? pkg : { ...pkg, version },
			),
			'@keepr/stream is versioned, but its package.json has no version',
		],
		[
			'a package with a version the config does not ignore',
			PACKAGES.map((pkg) =>
				pkg.name === '@keepr/engine-core' ? { ...pkg, version: '1.0.0' } : pkg,
			),
			'@keepr/engine-core carries a version',
		],
	])('refuses %s', (_case, packages, message) => {
		expect(check([], {}, { packages }).join('\n')).toContain(message);
	});
});

/**
 * The command line against real git: a local "origin" and a clone of it on a
 * branch, for each case. Nothing remote.
 */
describe("the check's command line", () => {
	const script = join(import.meta.dirname, '../scripts/changeset-check.mjs');
	const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
	const manifest = (fields: Record<string, unknown>) =>
		JSON.stringify({ private: true, ...fields });
	const WORKSPACE = {
		'.changeset/config.json': JSON.stringify({ ignore: IGNORED }),
		'.changeset/README.md': 'What a changeset is.\n',
		'.changeset/old-one.md': changeset({ '@keepr/stream': 'minor' }),
		'apps/stream/package.json': manifest({
			name: '@keepr/stream',
			version: '1.6.0',
			dependencies: { '@keepr/nuxt-layer': 'workspace:*' },
		}),
		'apps/stream/server/api/time.get.ts': 'export default 1;\n',
		'apps/stream/test/unit/time.test.ts': 'test;\n',
		'apps/score/package.json': manifest({ name: '@keepr/score' }),
		'packages/nuxt-layer/package.json': manifest({ name: '@keepr/nuxt-layer' }),
		'packages/nuxt-layer/src/index.ts': 'export {};\n',
	};

	let workspace: string;
	let origin: string;

	function git(cwd: string, ...args: string[]) {
		return execFileSync('git', args, { cwd, encoding: 'utf8', env: gitEnv }).trim();
	}

	function write(root: string, files: Record<string, string>) {
		for (const [file, content] of Object.entries(files)) {
			mkdirSync(join(root, dirname(file)), { recursive: true });
			writeFileSync(join(root, file), content);
		}
	}

	function commitAll(cwd: string, message: string) {
		git(cwd, 'add', '-A');
		git(
			cwd,
			'-c',
			'user.name=test',
			'-c',
			'user.email=t@example.invalid',
			'commit',
			'-qm',
			message,
		);
	}

	beforeAll(() => {
		workspace = mkdtempSync(join(tmpdir(), 'changeset-check-'));
		origin = join(workspace, 'origin');
		mkdirSync(origin);
		git(origin, 'init', '-q', '-b', 'main');
		write(origin, WORKSPACE);
		commitAll(origin, 'chore: the base');
	});

	afterAll(() => {
		rmSync(workspace, { recursive: true, force: true });
	});

	/** A clone of main on a branch of its own, with `files` written (and committed, unless `uncommitted`). */
	function branch(
		files: Record<string, string>,
		{ uncommitted = false, remove = [] as string[] } = {},
	) {
		const checkout = join(mkdtempSync(join(workspace, 'case-')), 'checkout');
		git(workspace, 'clone', '-q', `file://${origin}`, checkout);
		git(checkout, 'switch', '-q', '-c', 'feature');
		write(checkout, files);
		for (const file of remove) rmSync(join(checkout, file));
		if (!uncommitted) commitAll(checkout, 'fix: the change');
		return checkout;
	}

	function run(cwd: string, env: Record<string, string> = {}) {
		const result = spawnSync(process.execPath, [script], {
			cwd,
			encoding: 'utf8',
			env: { ...gitEnv, GITHUB_EVENT_NAME: '', GITHUB_EVENT_PATH: '', ...env },
		});
		return { passed: result.status === 0, output: `${result.stdout}${result.stderr}` };
	}

	it('fails a branch touching the shared layer without a changeset naming @keepr/stream', () => {
		const { passed, output } = run(
			branch({ 'packages/nuxt-layer/src/index.ts': 'export const a = 1;\n' }),
		);

		expect(passed).toBe(false);
		expect(output).toContain('@keepr/stream ships this change');
	});

	it("passes a branch touching only Stream Keepr's tests", () => {
		expect(run(branch({ 'apps/stream/test/unit/time.test.ts': 'test 2;\n' })).passed).toBe(true);
	});

	it('reads a changeset not yet committed', () => {
		const checkout = branch(
			{
				'apps/stream/server/api/time.get.ts': 'export default 2;\n',
				'.changeset/brave-owls.md': changeset({ '@keepr/stream': 'minor' }),
			},
			{ uncommitted: true },
		);

		expect(run(checkout).passed).toBe(true);
	});

	it('passes the Version PR, which bumps the app and consumes the changesets naming it', () => {
		const checkout = branch(
			{
				'apps/stream/package.json': manifest({
					name: '@keepr/stream',
					version: '1.7.0',
					dependencies: { '@keepr/nuxt-layer': 'workspace:*' },
				}),
				'apps/stream/CHANGELOG.md': '# @keepr/stream\n\n## 1.7.0\n',
			},
			{ remove: ['.changeset/old-one.md'] },
		);

		expect(run(checkout).passed).toBe(true);
	});

	it("fails a branch that deletes another change's pending changeset but bumps no app", () => {
		const { passed, output } = run(
			branch(
				{ 'packages/nuxt-layer/src/index.ts': 'export const a = 1;\n' },
				{ remove: ['.changeset/old-one.md'] },
			),
		);

		expect(passed).toBe(false);
		expect(output).toContain('@keepr/stream ships this change');
	});

	it("on a PR, measures CI's test merge commit against its base", () => {
		const checkout = branch({ 'packages/nuxt-layer/src/index.ts': 'export const a = 1;\n' });
		git(checkout, 'switch', '-q', 'main');
		git(
			checkout,
			'-c',
			'user.name=test',
			'-c',
			'user.email=t@example.invalid',
			'merge',
			'-q',
			'--no-ff',
			'-m',
			'Merge feature',
			'feature',
		);
		const eventPath = join(dirname(checkout), 'event.json');
		writeFileSync(eventPath, JSON.stringify({ pull_request: { draft: false } }));

		const { passed, output } = run(checkout, {
			GITHUB_EVENT_NAME: 'pull_request',
			GITHUB_EVENT_PATH: eventPath,
		});

		expect(passed).toBe(false);
		expect(output).toContain('::error title=Changeset::@keepr/stream ships this change');
	});

	it('fails when there is no main to measure the change against', () => {
		const alone = join(mkdtempSync(join(workspace, 'alone-')), 'checkout');
		mkdirSync(alone);
		git(alone, 'init', '-q', '-b', 'work');
		write(alone, WORKSPACE);
		commitAll(alone, 'chore: no main anywhere');

		const { passed, output } = run(alone);

		expect(passed).toBe(false);
		expect(output).toContain('nothing to measure');
	});
});
