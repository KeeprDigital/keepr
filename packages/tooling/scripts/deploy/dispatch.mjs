#!/usr/bin/env node
/**
 * A Release deploys itself (ADR-0125): once the release workflow has tagged
 * and published the GitHub Releases, it starts one Deploy run with every app
 * it released, to staging and then, behind the `production` environment's
 * approval, to production. Nothing deploys per merge to main, and nothing
 * starts when nothing was released.
 *
 * Run by the release workflow's dispatch job from its own commit, with
 * `PUBLISHED_PACKAGES` (changesets/action's `published-packages`),
 * `GITHUB_REPOSITORY` and `GH_TOKEN` (`GITHUB_TOKEN` with `actions: write`,
 * whose `workflow_dispatch` starts a run).
 */

import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { STAGING_THEN_PRODUCTION } from './plan.mjs';

const APP_PACKAGE = /^@keepr\/[a-z]+$/;
const VERSION = /^[0-9A-Za-z.+-]+$/;

/**
 * The tag of each app's Release the action published.
 *
 * @param {string} publishedPackages JSON, `[{ name, version }]`; empty when none
 * @returns {string[]}
 */
export function releasedTags(publishedPackages) {
	if (publishedPackages.trim() === '') return [];
	/** @type {{ name?: unknown, version?: unknown }[]} */
	const packages = JSON.parse(publishedPackages);
	return packages.map(({ name, version }) => {
		if (
			typeof name !== 'string' ||
			typeof version !== 'string' ||
			!APP_PACKAGE.test(name) ||
			!VERSION.test(version)
		)
			throw new Error(`${JSON.stringify({ name, version })} is not an app's Release.`);
		return `${name}@${version}`;
	});
}

function main() {
	const { env } = process;
	try {
		const tags = releasedTags(env.PUBLISHED_PACKAGES ?? '');
		if (tags.length === 0) {
			console.log('Nothing was released, so nothing deploys.');
			return;
		}
		const result = spawnSync(
			'gh',
			[
				'workflow',
				'run',
				'deploy.yml',
				'--repo',
				env.GITHUB_REPOSITORY ?? '',
				// The Environments' GitHub environments deploy only from main.
				'--ref',
				'main',
				'-f',
				`releases=${tags.join(' ')}`,
				'-f',
				`environment=${STAGING_THEN_PRODUCTION}`,
			],
			{ stdio: 'inherit' },
		);
		if (result.status !== 0)
			throw new Error(
				`gh workflow run failed${result.error ? `: ${result.error.message}` : ''}; dispatch Deploy by hand with releases "${tags.join(' ')}".`,
			);
		const line = `Started a Deploy of ${tags.join(', ')} to ${STAGING_THEN_PRODUCTION}.`;
		console.log(line);
		if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${line}\n`);
	} catch (error) {
		console.log(`::error::${error instanceof Error ? error.message : error}`);
		process.exitCode = 1;
	}
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
