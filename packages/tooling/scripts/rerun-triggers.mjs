/**
 * An app's Vitest `forceRerunTriggers`, held to what can affect its tests
 * (ADR-0148).
 *
 * Under `--changed` (`pnpm verify:quick`), Vitest runs the tests whose imports
 * reach a changed file, and the whole suite when a changed file matches a
 * trigger: a file every test depends on and none imports, such as a manifest,
 * a Vitest config or setup file, or a migration the SQLite harness reads from
 * disk. Vitest matches the triggers against every file the repository's diff
 * names, as an absolute path, so a pattern such as `**\/package.json` matched
 * every project's: an edit to Score Keepr's manifest, or a migration of Keepr
 * Accounts, ran Stream Keepr's whole unit and Nuxt suites.
 *
 * Here each pattern is held to the app's own directory and to each workspace
 * package it depends on (`dependenciesOf`, `project-graph.mjs`), and the
 * lockfile, which installs them all, is one more trigger.
 */

import { fileURLToPath } from 'node:url';
import { dependenciesOf } from './project-graph.mjs';
import { workspacePackages } from './versioned-apps.mjs';

/** @typedef {import('./versioned-apps.mjs').WorkspacePackage} WorkspacePackage */

const WORKSPACE_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * The triggers for one project's suite.
 *
 * Each is a glob that matches an absolute path wherever the checkout is, by
 * the project's directory from the repository's root (`**\/apps/stream/…`).
 *
 * @param {string} project the project's name, as its `package.json` gives it
 * @param {readonly string[]} patterns globs, each relative to a project's directory
 * @param {Map<string, WorkspacePackage>} [packages] the workspace's packages, by name
 * @returns {string[]} the globs
 */
export function rerunTriggers(project, patterns, packages = workspacePackages(WORKSPACE_ROOT)) {
	if (!packages.has(project)) throw new Error(`rerunTriggers: no project named ${project}`);
	const directories = [project, ...dependenciesOf(project, packages)].map(
		(name) => packages.get(name)?.dir,
	);
	return [
		'**/pnpm-lock.yaml',
		...directories.flatMap((directory) => patterns.map((pattern) => `**/${directory}/${pattern}`)),
	];
}
