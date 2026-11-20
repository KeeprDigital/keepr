/**
 * What a build records of where it came from, and the refusal of a build that
 * did not come from here. The build leaves `keepr-build.json` in its output
 * directory, so it travels with the artifact every Environment deploys: the
 * commit it was built from, and each of the descriptor's `testFlags` that was
 * set in its environment (Stream Keepr's integration build compiles test
 * routes into the Worker).
 *
 * A production deploy is of a Release: from a clean checkout whose `HEAD` is
 * the app's Release tag, `@keepr/<app>@<version>`. Anything else needs a
 * written reason (`--unreleased`), which the app's marker records, as
 * overriding deploy order does (`unreleasedRefusal`).
 *
 * A deploy refuses, before its first remote change, a build whose record is
 * missing, names another commit than the checkout's, or was made with a
 * test-only flag set; `check --env`, `status` and `mark-app`, which read the
 * built configuration, refuse one that was not built from this checkout.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const BUILD_RECORD = 'keepr-build.json';

/**
 * @typedef {{ commit: string, testFlags: string[] }} BuildRecord
 */

/**
 * The test-only flags `env` sets: each the descriptor names whose value is
 * not empty, `false` or `0`.
 *
 * @param {import('./release.mjs').Descriptor} descriptor
 * @param {Record<string, string | undefined>} env
 */
export function testFlagsSet(descriptor, env) {
	return (descriptor.testFlags ?? []).filter((flag) => {
		const value = env[flag];
		return value !== undefined && value !== '' && value !== 'false' && value !== '0';
	});
}

/**
 * Write the record into the build's output.
 *
 * @param {Pick<import('./release.mjs').Release, 'appDir' | 'descriptor'>} release
 * @param {BuildRecord} record
 */
export function recordBuild({ appDir, descriptor }, record) {
	mkdirSync(join(appDir, descriptor.output), { recursive: true });
	writeFileSync(join(appDir, descriptor.output, BUILD_RECORD), `${JSON.stringify(record)}\n`);
}

/**
 * The record the build in the app's output left, or `undefined` without one.
 *
 * @param {Pick<import('./release.mjs').Release, 'appDir' | 'descriptor'>} release
 * @returns {BuildRecord | undefined}
 */
export function readBuildRecord({ appDir, descriptor }) {
	try {
		const record = JSON.parse(readFileSync(join(appDir, descriptor.output, BUILD_RECORD), 'utf8'));
		if (typeof record?.commit !== 'string' || !Array.isArray(record.testFlags)) return undefined;
		return record;
	} catch {
		return undefined;
	}
}

/**
 * Throw unless the build was made from `commit`, the checkout's.
 *
 * @param {BuildRecord | undefined} record
 * @param {string} commit
 */
export function refuseForeignBuild(record, commit) {
	if (!record)
		throw new Error(
			`the build records no commit (${BUILD_RECORD}): build this checkout with keepr-deploy build.`,
		);
	if (record.commit !== commit)
		throw new Error(
			`the build was built from ${record.commit}, and this checkout is at ${commit}: build this checkout, or check out the build's commit.`,
		);
}

/**
 * Throw unless the build was made from `commit` with no test-only flag set:
 * what a deploy requires before its first remote change.
 *
 * @param {BuildRecord | undefined} record
 * @param {string} commit
 */
export function refuseUndeployableBuild(record, commit) {
	refuseForeignBuild(record, commit);
	const flags = /** @type {BuildRecord} */ (record).testFlags;
	if (flags.length > 0)
		throw new Error(
			`the build was made with ${flags.join(', ')} set, which only a test build sets: build again without it.`,
		);
}

/** The Environment whose deploys must be of a Release. */
const RELEASED_ONLY = 'production';

/**
 * Why a deploy of this checkout to `environment` is not of a Release, unless
 * `unreleased` gives a reason: throws to refuse, or answers the field the
 * app's marker records.
 *
 * @param {{
 *   release: import('./release.mjs').Release,
 *   environment: string,
 *   dirty: boolean,
 *   tagsAtHead: readonly string[],
 *   unreleased?: string | undefined,
 * }} options
 * @returns {Record<string, string>} `{ unreleased }` when the reason was needed
 */
export function unreleasedRefusal({ release, environment, dirty, tagsAtHead, unreleased }) {
	// Given anyway, the reason is recorded: a marker says what its deployer said.
	if (environment !== RELEASED_ONLY) return unreleased === undefined ? {} : { unreleased };
	const tag = `@keepr/${release.app}@${release.version}`;
	const problems = [
		...(dirty ? ['the checkout is dirty'] : []),
		...(tagsAtHead.includes(tag) ? [] : [`HEAD is not ${tag}`]),
	];
	if (problems.length === 0) return {};
	if (unreleased === undefined)
		throw new Error(
			`a ${environment} deploy is of a Release, and ${problems.join(' and ')}: check out the Release's tag, or deploy with --unreleased <reason>.`,
		);
	return { unreleased };
}
