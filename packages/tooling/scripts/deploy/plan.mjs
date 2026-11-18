#!/usr/bin/env node
/**
 * What a Deploy run deploys: the Deploy workflow's `plan` job.
 *
 * The run names apps and Releases in its `releases` input, separated by spaces
 * or commas: `<app>` or `@keepr/<app>@latest` for the app's most recent
 * published GitHub Release, `@keepr/<app>@<version>` for that one. Each must
 * resolve to a published Release, or the run deploys nothing. Keepr Accounts
 * comes out apart from the Apps, so its job runs before theirs (ADR-0120); the
 * Apps deploy side by side, each as its own job.
 *
 * It deploys to one Environment, or, for a Release (ADR-0125), to staging and
 * then production: `environment` is an Environment's name or
 * `STAGING_THEN_PRODUCTION`.
 *
 * Run by the workflow from its own commit, with `INPUT_RELEASES`,
 * `INPUT_ENVIRONMENT`, `INPUT_OVERRIDE`, `GITHUB_REPOSITORY` and `GH_TOKEN`; it
 * writes `accounts` (a tag, or empty), `apps` and `builds` (JSON,
 * `[{ app, release }]`; `builds` is every app, Keepr Accounts too) and
 * `environments` (JSON, in deploy order) to `GITHUB_OUTPUT`, and the plan to
 * the step summary, with what to confirm before approving production.
 */

import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { KEEPR_ACCOUNTS } from './order.mjs';

/** @typedef {{ tagName: string, publishedAt: string }} PublishedRelease */
/** @typedef {{ app: string, release: string }} PlannedDeploy */

/** The Environments the Deploy workflow has jobs for, in the order a Release reaches them. */
export const ENVIRONMENTS = ['staging', 'production'];
/** The Environment input of a Release's run: staging, and then, once approved, production. */
export const STAGING_THEN_PRODUCTION = 'staging then production';

const APP = /^[a-z]+$/;
const RELEASE = /^@keepr\/([a-z]+)@([^@\s]+)$/;

/**
 * The most recent published Release of `app`, by publication.
 *
 * @param {string} app
 * @param {PublishedRelease[]} published
 */
function latest(app, published) {
	const tag = published
		.filter((release) => release.tagName.startsWith(`@keepr/${app}@`))
		.toSorted((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt))
		.at(-1)?.tagName;
	if (tag === undefined) throw new Error(`there is no @keepr/${app}@* GitHub Release to deploy.`);
	return tag;
}

/**
 * @param {string} entry
 * @param {PublishedRelease[]} published
 * @returns {PlannedDeploy}
 */
function resolveEntry(entry, published) {
	if (APP.test(entry)) return { app: entry, release: latest(entry, published) };
	const [, app, version] = entry.match(RELEASE) ?? [];
	if (app === undefined || version === undefined)
		throw new Error(
			`${entry} is not an app or a Release: name an app (stream), or a Release tagged @keepr/<app>@<version> or @keepr/<app>@latest.`,
		);
	if (version === 'latest') return { app, release: latest(app, published) };
	if (!published.some((release) => release.tagName === entry))
		throw new Error(`${entry} is not a published Release.`);
	return { app, release: entry };
}

/**
 * @param {string} environment
 * @returns {string[]}
 */
function resolveEnvironments(environment) {
	if (environment === STAGING_THEN_PRODUCTION) return [...ENVIRONMENTS];
	if (ENVIRONMENTS.includes(environment)) return [environment];
	throw new Error(
		`${JSON.stringify(environment)} is no Environment this workflow deploys: name one of ${ENVIRONMENTS.join(', ')}, or "${STAGING_THEN_PRODUCTION}".`,
	);
}

/**
 * The run's deploys, or why it deploys nothing.
 *
 * @param {{ requested: string, environment: string, override: string, published: PublishedRelease[] }} options
 *   `override`: the order override's reason, or empty. It bypasses one app's
 *   order check, so it is refused for a run of several apps.
 * @returns {{ accounts: string, apps: PlannedDeploy[], builds: PlannedDeploy[], environments: string[] }}
 *   `accounts`: Keepr Accounts' Release, or empty when the run does not deploy
 *   it; `builds`: every app's, built once for every Environment.
 */
export function planDeploy({ requested, environment, override, published }) {
	const environments = resolveEnvironments(environment);
	const deploys = requested
		.split(/[\s,]+/)
		.filter(Boolean)
		.map((entry) => resolveEntry(entry, published));
	if (deploys.length === 0)
		throw new Error('the run names no app: set releases, e.g. "stream" or "@keepr/stream@1.7.0".');
	for (const [index, { app }] of deploys.entries())
		if (deploys.findIndex((deploy) => deploy.app === app) !== index)
			throw new Error(`the run names ${app} twice: one Release per app.`);
	if (override.trim() !== '' && deploys.length > 1)
		throw new Error(
			"an override bypasses one app's deploy order: dispatch the app it is for alone.",
		);
	return {
		accounts: deploys.find(({ app }) => app === KEEPR_ACCOUNTS.app)?.release ?? '',
		apps: deploys.filter(({ app }) => app !== KEEPR_ACCOUNTS.app),
		builds: deploys,
		environments,
	};
}

/**
 * What the reviewer confirms before approving production: the run's page
 * shows this summary beside "Review deployments". GitHub's review dialog
 * itself shows no text of the repository's.
 *
 * @param {string[]} environments
 */
function approvalChecklist(environments) {
	if (!environments.includes('production')) return [];
	return [
		'### Before approving production',
		'',
		'Approve the `production` environment in "Review deployments" only when:',
		'',
		'- Nothing is on air on any production Installation this run deploys.',
		...(environments.includes('staging')
			? [
					'- Every staging job passed: deployed, verified, and its unattended acceptance gates green.',
					'- The acceptance gates that write ran against staging and passed, when this Release needs them (apps/stream/README.md § Deploy day).',
				]
			: [
					'- This is a rollback or a redeploy: the Release already passed staging, or production must have it now.',
				]),
		'',
		"Each production job reads its D1 databases' Time Travel bookmarks before it changes anything, refuses without one, and records them in its summary and marker.",
	];
}

/**
 * Every published Release, through `gh`: no draft and no pre-release deploys.
 *
 * @param {string} repository
 * @returns {PublishedRelease[]}
 */
function publishedReleases(repository) {
	const result = spawnSync(
		'gh',
		[
			'release',
			'list',
			'--repo',
			repository,
			'--exclude-drafts',
			'--exclude-pre-releases',
			'--limit',
			'1000',
			'--json',
			'tagName,publishedAt',
		],
		{ encoding: 'utf8' },
	);
	if (result.status !== 0)
		throw new Error(`gh release list failed: ${result.error?.message ?? result.stderr.trim()}`);
	return JSON.parse(result.stdout);
}

function main() {
	const { env } = process;
	try {
		const plan = planDeploy({
			requested: env.INPUT_RELEASES ?? '',
			environment: env.INPUT_ENVIRONMENT ?? '',
			override: env.INPUT_OVERRIDE ?? '',
			published: publishedReleases(env.GITHUB_REPOSITORY ?? ''),
		});
		const lines = [
			...(plan.accounts === '' ? [] : [`- ${plan.accounts}, before the Apps`]),
			...plan.apps.map(({ release }) => `- ${release}`),
		];
		const to = `to ${plan.environments.join(', then ')}`;
		console.log(`Deploying ${to}:\n${lines.join('\n')}`);
		if (env.GITHUB_STEP_SUMMARY)
			appendFileSync(
				env.GITHUB_STEP_SUMMARY,
				[`### Deploying ${to}`, '', ...lines, '', ...approvalChecklist(plan.environments), ''].join(
					'\n',
				),
			);
		if (env.GITHUB_OUTPUT)
			appendFileSync(
				env.GITHUB_OUTPUT,
				[
					`accounts=${plan.accounts}`,
					`apps=${JSON.stringify(plan.apps)}`,
					`builds=${JSON.stringify(plan.builds)}`,
					`environments=${JSON.stringify(plan.environments)}`,
					'',
				].join('\n'),
			);
	} catch (error) {
		console.log(`::error::${error instanceof Error ? error.message : error}`);
		process.exitCode = 1;
	}
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
