/**
 * The workspace's projects, each app and each package, and which of them a
 * change can affect (ADR-0147). CI runs a gate only for a change that affects
 * a project it checks (`ci-scope.mjs`).
 *
 * The graph is the projects' own `package.json` files: a project depends on
 * each workspace package it names in `dependencies` or `devDependencies`. Its
 * build and code import the first, its tests the second. A change to a file of
 * one project affects that project and every project that depends on it, one
 * through another. Besides that:
 *
 * - **A file no dependent can import affects its own project alone**
 *   (`reachesDependents`): a test file (`*.test.ts`), which no other project
 *   runs, and, in a package whose `exports` name nothing under its `test/`,
 *   any file there. A package without `exports` lets its dependents import
 *   its test helpers, so those reach them like any other file of it.
 * - **A manifest affects every project** (`MANIFEST`). It can change the graph
 *   itself, and it is read across projects without an import: the tooling
 *   reads each one, and Stream Keepr's wiring test reads each app's scripts.
 * - **A deploy descriptor or a Wrangler configuration affects the tooling
 *   too** (`READ_BY_THE_TOOLING`): the deploy tooling's tests read the
 *   workspace's own.
 * - **The tooling's scripts affect every project** (`AFFECTS_EVERY_PROJECT`):
 *   they run the apps' heavy gates (`keepr-slots`) and deploys, and CI's own
 *   scope and reuse decisions.
 * - **A file in no project affects every project**: nothing says what reads
 *   it. Among them is what every project is built and checked with: the
 *   lockfile, the workspace's settings, the compiler options, the lint and
 *   format configuration, and CI's workflow and its setup.
 *
 * Markdown is the caller's to leave out: no project's gates but the
 * documentation test read a document.
 */

/** @typedef {import('./versioned-apps.mjs').WorkspacePackage} WorkspacePackage */

/** What every project is built or checked with, though it is a project's own file. */
export const AFFECTS_EVERY_PROJECT = /^packages\/tooling\/scripts\//;
/** Any manifest, the root's among them. */
const MANIFEST = /(?:^|\/)package\.json$/;
/** A deploy descriptor, or a Wrangler configuration, in any project. */
const READ_BY_THE_TOOLING = /(?:^|\/)(?:deploy\.jsonc|[^/]*wrangler[^/]*\.jsonc?)$/;
const TOOLING = '@keepr/tooling';
const TEST_FILE = /\.test\.ts$/;

/**
 * Each project's direct dependents: the projects that name it, as a workspace
 * package, in their `dependencies` or `devDependencies`.
 *
 * @param {Map<string, WorkspacePackage>} packages the workspace's packages, by name
 * @returns {Map<string, Set<string>>} by name
 */
export function dependentsOf(packages) {
	/** @type {Map<string, Set<string>>} */
	const dependents = new Map([...packages.keys()].map((name) => [name, new Set()]));
	for (const pkg of packages.values())
		for (const [name, spec] of Object.entries({
			...pkg.dependencies,
			...pkg.devDependencies,
		}))
			if (spec.startsWith('workspace:')) dependents.get(name)?.add(pkg.name);
	return dependents;
}

/**
 * The projects `name` depends on, one through another: every workspace
 * package its build, code or tests can import.
 *
 * @param {string} name a project's name
 * @param {Map<string, WorkspacePackage>} packages
 * @returns {Set<string>} their names, `name`'s own left out
 */
export function dependenciesOf(name, packages) {
	/** @type {Set<string>} */
	const found = new Set();
	const queue = [name];
	for (const next of queue) {
		const pkg = packages.get(next);
		if (!pkg) continue;
		for (const [dependency, spec] of Object.entries({
			...pkg.dependencies,
			...pkg.devDependencies,
		}))
			if (spec.startsWith('workspace:') && packages.has(dependency) && !found.has(dependency)) {
				found.add(dependency);
				queue.push(dependency);
			}
	}
	found.delete(name);
	return found;
}

/**
 * The project a file belongs to, if any.
 *
 * @param {string} file a path from the repository's root
 * @param {Map<string, WorkspacePackage>} packages
 * @returns {WorkspacePackage | undefined}
 */
export function projectOf(file, packages) {
	for (const pkg of packages.values()) if (file.startsWith(`${pkg.dir}/`)) return pkg;
	return undefined;
}

/**
 * Every path a package's `exports` maps to, whatever the conditions.
 *
 * @param {unknown} exports
 * @returns {string[]} the targets, as written (`./src/index.ts`)
 */
function exportTargets(exports) {
	if (typeof exports === 'string') return [exports];
	if (Array.isArray(exports)) return exports.flatMap(exportTargets);
	if (exports && typeof exports === 'object') return Object.values(exports).flatMap(exportTargets);
	return [];
}

/**
 * Whether a dependent can import a file of `pkg`, and so is affected by it.
 *
 * @param {string} file a path from the repository's root, inside `pkg`
 * @param {WorkspacePackage} pkg
 */
function reachesDependents(file, pkg) {
	if (TEST_FILE.test(file)) return false;
	if (pkg.exports === undefined || !file.startsWith(`${pkg.dir}/test/`)) return true;
	return exportTargets(pkg.exports).some((target) => /^(?:\.\/)?test\//.test(target));
}

/**
 * The projects a change can affect, by name.
 *
 * @param {readonly string[]} changedFiles paths from the repository's root, Markdown left out
 * @param {Map<string, WorkspacePackage>} packages the workspace's packages, by name (`workspacePackages`)
 * @returns {Set<string>} the affected projects' names; every project's when a file affects every one
 */
export function affectedProjects(changedFiles, packages) {
	const every = new Set(packages.keys());
	const dependents = dependentsOf(packages);
	/** @type {Set<string>} */
	const affected = new Set();
	/** The projects whose dependents are affected with them. */
	const reached = new Set();
	/** @param {string} name */
	const withDependents = (name) => {
		const queue = [name];
		for (const next of queue) {
			if (reached.has(next)) continue;
			reached.add(next);
			affected.add(next);
			queue.push(...(dependents.get(next) ?? []));
		}
	};
	for (const file of changedFiles) {
		if (AFFECTS_EVERY_PROJECT.test(file) || MANIFEST.test(file)) return every;
		const project = projectOf(file, packages);
		if (!project) return every;
		if (READ_BY_THE_TOOLING.test(file) && packages.has(TOOLING)) affected.add(TOOLING);
		if (reachesDependents(file, project)) withDependents(project.name);
		else affected.add(project.name);
	}
	return affected;
}
