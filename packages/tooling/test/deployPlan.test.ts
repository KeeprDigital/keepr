import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { afterEach, describe, expect, it } from 'vitest';
import { STAGING_THEN_PRODUCTION, planDeploy } from '../scripts/deploy/plan.mjs';

const PLAN = join(import.meta.dirname, '../scripts/deploy/plan.mjs');

/** Published GitHub Releases, as `gh release list` returns them: newest is not always first. */
const PUBLISHED = [
	{ tagName: '@keepr/stream@1.7.0', publishedAt: '2026-11-10T10:00:00Z' },
	{ tagName: '@keepr/accounts@0.2.0', publishedAt: '2026-11-12T10:00:00Z' },
	{ tagName: '@keepr/stream@1.8.0', publishedAt: '2026-11-14T10:00:00Z' },
	{ tagName: '@keepr/accounts@0.1.0', publishedAt: '2026-11-01T10:00:00Z' },
	{ tagName: 'v1.6.0', publishedAt: '2026-11-15T10:00:00Z' },
	{ tagName: '@keepr/streaming@9.0.0', publishedAt: '2026-11-16T10:00:00Z' },
];

describe('a Deploy run resolves the Release of each app it names, Keepr Accounts first', () => {
	it.each([
		['an app alone, its most recent Release', 'stream', '', [['stream', '@keepr/stream@1.8.0']]],
		['a Release named by its tag', '@keepr/stream@1.7.0', '', [['stream', '@keepr/stream@1.7.0']]],
		['latest by tag', '@keepr/stream@latest', '', [['stream', '@keepr/stream@1.8.0']]],
		[
			'Keepr Accounts apart from the Apps, whatever the order named',
			'stream, accounts',
			'@keepr/accounts@0.2.0',
			[['stream', '@keepr/stream@1.8.0']],
		],
		['Keepr Accounts alone', '@keepr/accounts@0.1.0', '@keepr/accounts@0.1.0', []],
	])('%s', (_, requested, accounts, apps) => {
		expect(
			planDeploy({ requested, environment: 'production', override: '', published: PUBLISHED }),
		).toMatchObject({
			accounts,
			apps: apps.map(([app, release]) => ({ app, release })),
		});
	});

	// One build per app is what every Environment deploys, Keepr Accounts' too.
	it('builds every app the run deploys, Keepr Accounts with the Apps', () => {
		expect(
			planDeploy({
				requested: 'stream accounts',
				environment: 'production',
				override: '',
				published: PUBLISHED,
			}).builds,
		).toEqual([
			{ app: 'stream', release: '@keepr/stream@1.8.0' },
			{ app: 'accounts', release: '@keepr/accounts@0.2.0' },
		]);
	});

	it.each([
		['nothing named', ' ', /names no app/],
		['an app with no Release', 'score', /no @keepr\/score@\* GitHub Release/],
		['a tag that is not a published Release', '@keepr/stream@1.9.0', /not a published Release/],
		['a v* tag', 'v1.6.0', /not an app or a Release/],
		['an app named twice', 'stream @keepr/stream@1.7.0', /names stream twice/],
	])('refuses %s', (_, requested, refusal) => {
		expect(() =>
			planDeploy({ requested, environment: 'production', override: '', published: PUBLISHED }),
		).toThrow(refusal);
	});

	// An override bypasses one app's order check; it must not reach another's unread.
	it.each([
		['one app', 'stream', true],
		['several apps', 'accounts stream', false],
	])('takes an override for %s only', (_, requested, accepted) => {
		const plan = () =>
			planDeploy({
				requested,
				environment: 'production',
				override: 'accounts is down',
				published: PUBLISHED,
			});

		if (accepted) expect(plan).not.toThrow();
		else expect(plan).toThrow(/dispatch the app it is for alone/);
	});
});

// A Release's run deploys staging, then production; a dispatch by hand, one Environment.
describe('a Deploy run deploys to one Environment, or to staging and then production', () => {
	it.each([
		['production alone', 'production', ['production']],
		['staging alone', 'staging', ['staging']],
		['staging, then production', STAGING_THEN_PRODUCTION, ['staging', 'production']],
	])('%s', (_, environment, environments) => {
		expect(
			planDeploy({ requested: 'stream', environment, override: '', published: PUBLISHED })
				.environments,
		).toEqual(environments);
	});

	it.each([
		['no Environment', ''],
		['an Environment no job deploys', 'preview'],
		['production before staging', 'production then staging'],
	])('refuses %s', (_, environment) => {
		expect(() =>
			planDeploy({ requested: 'stream', environment, override: '', published: PUBLISHED }),
		).toThrow(/Environment/);
	});
});

/**
 * The `plan` job's step: a fake `gh`, alone on PATH, answers with PUBLISHED and
 * records what it was asked; the outputs land where the workflow reads them.
 */
describe("the plan job's command line", () => {
	const roots: string[] = [];

	afterEach(() => {
		for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
	});

	function run(env: Record<string, string>) {
		const root = mkdtempSync(join(tmpdir(), 'keepr-plan-'));
		roots.push(root);
		const file = (name: string, content = '') => {
			writeFileSync(join(root, name), content);
			return join(root, name);
		};
		const published = file('published.json', JSON.stringify(PUBLISHED));
		const asked = file('asked');
		const output = file('output');
		const summary = file('summary');
		chmodSync(
			file('gh', `#!/bin/sh\nprintf '%s\\n' "$@" > '${asked}'\n/bin/cat '${published}'\n`),
			0o755,
		);
		const result = spawnSync(process.execPath, [PLAN], {
			env: {
				PATH: root,
				GITHUB_REPOSITORY: 'keepr/keepr',
				GH_TOKEN: 'test-token',
				GITHUB_OUTPUT: output,
				GITHUB_STEP_SUMMARY: summary,
				INPUT_OVERRIDE: '',
				INPUT_ENVIRONMENT: 'production',
				...env,
			},
			encoding: 'utf8',
		});
		const read = (path: string) => readFileSync(path, 'utf8');
		return {
			result,
			asked: read(asked).split('\n'),
			output: read(output),
			summary: read(summary),
		};
	}

	it("writes Keepr Accounts' Release and the Apps' for their jobs, from published Releases only", () => {
		const { result, asked, output, summary } = run({ INPUT_RELEASES: 'stream accounts' });

		expect(result.status, result.stderr).toBe(0);
		expect(output).toBe(
			[
				'accounts=@keepr/accounts@0.2.0',
				'apps=[{"app":"stream","release":"@keepr/stream@1.8.0"}]',
				'builds=[{"app":"stream","release":"@keepr/stream@1.8.0"},{"app":"accounts","release":"@keepr/accounts@0.2.0"}]',
				'environments=["production"]',
				'',
			].join('\n'),
		);
		expect(asked).toEqual(
			expect.arrayContaining([
				'release',
				'list',
				'--repo',
				'keepr/keepr',
				'--exclude-drafts',
				'--exclude-pre-releases',
			]),
		);
		expect(summary).toContain('@keepr/stream@1.8.0');
	});

	// The run's page, where "Review deployments" waits, shows every job's summary.
	it.each([
		['production', STAGING_THEN_PRODUCTION, true],
		['production alone', 'production', true],
		['staging alone', 'staging', false],
	])(
		'puts the checklist before approving production in its summary for %s',
		(_, environment, shown) => {
			const { summary } = run({ INPUT_RELEASES: 'stream', INPUT_ENVIRONMENT: environment });

			expect(summary.includes('Before approving production')).toBe(shown);
			expect(summary.includes('Nothing is on air')).toBe(shown);
		},
	);

	it('refuses as a workflow error, and writes no output a job could run on', () => {
		const { result, output } = run({ INPUT_RELEASES: 'score' });

		expect(result.status).toBe(1);
		expect(result.stdout).toContain('::error::there is no @keepr/score@* GitHub Release');
		expect(output).toBe('');
	});
});
