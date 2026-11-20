/**
 * An app's **shipped code** (ADR-0118): what a change must touch to change
 * what the app's Release runs. The changeset check asks a changeset for each
 * app a change ships in (`changeset-check.mjs`); CI builds each deployable
 * app's Worker only when a change ships in it (`ci-scope.mjs`).
 *
 * It is
 *
 * - the app's directory, and the directory of each workspace package its
 *   `dependencies` reach, one through another, each without `test/`, `docs/`
 *   and Markdown (the tooling and the test kits are dev dependencies);
 * - for every app, what every app's Release is built with: `pnpm-lock.yaml`
 *   and `pnpm-workspace.yaml` (the versions), the root `package.json` (the
 *   Node and pnpm it pins) and `tsconfig.base.json` (the packages' compiler
 *   options). CI builds every Worker leg for each of these (`ci-scope.mjs`).
 */

/** What every app ships: what it is built with. */
const SHIPPED_BY_EVERY_APP = new Set([
	'pnpm-lock.yaml',
	'pnpm-workspace.yaml',
	'package.json',
	'tsconfig.base.json',
]);
/** Inside a shipped directory, what no app ships. */
const NOT_SHIPPED = /^(?:test|docs)\/|\.md$/;

/**
 * The directories an app ships: its own and each workspace package its
 * `dependencies` reach.
 *
 * @param {import('./versioned-apps.mjs').WorkspacePackage} app
 * @param {Map<string, import('./versioned-apps.mjs').WorkspacePackage>} packages the workspace's packages, by name
 * @returns {string[]} the directories, from the repository's root
 */
export function shippedDirectories(app, packages) {
	const reached = new Set([app.name]);
	const queue = [app];
	for (const pkg of queue)
		for (const [name, spec] of Object.entries(pkg.dependencies)) {
			const dependency = packages.get(name);
			if (!spec.startsWith('workspace:') || !dependency || reached.has(name)) continue;
			reached.add(name);
			queue.push(dependency);
		}
	return queue.map((pkg) => pkg.dir);
}

/**
 * @param {string} file a path from the repository's root
 * @param {readonly string[]} directories what the app ships
 */
export function ships(file, directories) {
	if (SHIPPED_BY_EVERY_APP.has(file)) return true;
	return directories.some(
		(dir) => file.startsWith(`${dir}/`) && !NOT_SHIPPED.test(file.slice(dir.length + 1)),
	);
}
