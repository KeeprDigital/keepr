/**
 * The workspace's packages, and which of them Changesets versions and tags
 * (ADR-0118).
 *
 * An app is versioned unless `.changeset/config.json` ignores it: an app
 * without a deploy descriptor is ignored until it gets one. Packages are
 * consumed as source (ADR-0092) and are never versioned; the config ignores
 * the ones that carry a version of their own.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Where the workspace's packages are: the globs of `pnpm-workspace.yaml`, each `<directory>/*`. */
const WORKSPACE_DIRECTORIES = ['apps', 'packages'];

/**
 * @typedef {{
 *   name: string,
 *   dir: string,
 *   version?: string,
 *   dependencies: Record<string, string>,
 *   devDependencies?: Record<string, string>,
 *   exports?: unknown,
 *   scripts?: Record<string, string>,
 * }} WorkspacePackage
 */

/**
 * Every package of the workspace, by name; `dir` is its path from the root.
 *
 * @param {string} root the repository's root
 * @returns {Map<string, WorkspacePackage>} the packages
 */
export function workspacePackages(root) {
	/** @type {Map<string, WorkspacePackage>} */
	const packages = new Map();
	for (const parent of WORKSPACE_DIRECTORIES) {
		let entries;
		try {
			entries = readdirSync(join(root, parent), { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const dir = `${parent}/${entry.name}`;
			let manifest;
			try {
				manifest = JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8'));
			} catch {
				continue;
			}
			packages.set(manifest.name, {
				name: manifest.name,
				dir,
				version: manifest.version,
				dependencies: manifest.dependencies ?? {},
				devDependencies: manifest.devDependencies ?? {},
				exports: manifest.exports,
				scripts: manifest.scripts ?? {},
			});
		}
	}
	return packages;
}

/**
 * The packages `.changeset/config.json` ignores.
 *
 * @param {string} root the repository's root
 * @returns {Set<string>} their names
 */
export function ignoredPackages(root) {
	/** @type {{ ignore?: string[] }} */
	const config = JSON.parse(readFileSync(join(root, '.changeset/config.json'), 'utf8'));
	return new Set(config.ignore ?? []);
}

/**
 * The apps Changesets versions: each in `apps/` that the config does not ignore.
 *
 * @param {Map<string, WorkspacePackage>} packages the workspace's packages
 * @param {ReadonlySet<string>} ignored what the config ignores
 * @returns {WorkspacePackage[]} the versioned apps
 */
export function versionedApps(packages, ignored) {
	return [...packages.values()].filter(
		(pkg) => pkg.dir.startsWith('apps/') && !ignored.has(pkg.name),
	);
}

/**
 * What `changeset git-tag` tags: every package the config does not ignore
 * that has a version, app or not.
 *
 * @param {Map<string, WorkspacePackage>} packages the workspace's packages
 * @param {ReadonlySet<string>} ignored what the config ignores
 * @returns {WorkspacePackage[]} the packages it tags
 */
export function taggedPackages(packages, ignored) {
	return [...packages.values()].filter((pkg) => pkg.version && !ignored.has(pkg.name));
}
