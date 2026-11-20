#!/usr/bin/env node
/**
 * The changeset check (CI's `checks` job, and `pnpm verify:quick`): a change
 * names, in a changeset, each versioned app whose shipped code it touches, or
 * carries an empty changeset (ADR-0118).
 *
 * What an app's shipped code is: `scripts/shipped-code.mjs`.
 *
 * A changeset counts when the change adds, edits or consumes it, so the Version
 * PR, which bumps each app and deletes the changesets it released, passes. A
 * deleted changeset is consumed only for an app whose version the change
 * moves: deleting another change's pending changeset names no app. A
 * changeset may name only a versioned app (`scripts/versioned-apps.mjs`), and
 * only an app may carry a version the config does not ignore, since
 * `changeset git-tag` tags whatever does.
 *
 * What it measures:
 *
 * - **A PR or a merge group** (`GITHUB_EVENT_NAME`): the range CI's scope
 *   measures (`scripts/ci-scope.mjs`), from a checkout holding both ends.
 * - **Anywhere else**: this checkout's change since where it left `main`
 *   (`scripts/change-base.mjs`), committed or not.
 *
 * Anything it cannot measure fails rather than passes.
 *
 *   node packages/tooling/scripts/changeset-check.mjs
 *     (`keepr-changeset-check`; in CI reads GITHUB_EVENT_NAME, GITHUB_EVENT_PATH)
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { changeBase } from './change-base.mjs';
import { diffRange } from './ci-scope.mjs';
import { shippedDirectories, ships } from './shipped-code.mjs';
import {
	ignoredPackages,
	taggedPackages,
	versionedApps,
	workspacePackages,
} from './versioned-apps.mjs';

const CHANGESET = /^\.changeset\/(?!README\.md$)[^/]+\.md$/;
const BUMPS = new Set(['major', 'minor', 'patch']);
/** How many of an app's files a refusal lists before it stops. */
const MAX_LISTED_FILES = 5;

/**
 * @typedef {import('./versioned-apps.mjs').WorkspacePackage} WorkspacePackage
 * @typedef {{ file: string, text: string, deleted?: boolean }} ChangesetFile
 *   a changeset the change adds, edits or (`deleted`) removes
 */

/**
 * The apps a changeset names, from its front matter; `undefined` when it has none.
 *
 * @param {string} text the changeset
 * @returns {{ name: string, bump: string }[] | undefined} each app and its bump
 */
function releasesOf(text) {
	const frontMatter = text.match(/^---\r?\n([\s\S]*?)^---\s*$/m);
	if (!frontMatter || text.slice(0, frontMatter.index).trim() !== '') return undefined;
	/** @type {{ name: string, bump: string }[]} */
	const releases = [];
	for (const line of frontMatter[1].split(/\r?\n/)) {
		if (line.trim() === '') continue;
		const release = line.match(/^\s*(["']?)([^"':\s]+)\1\s*:\s*(\S+)\s*$/);
		if (!release) return undefined;
		releases.push({ name: release[2], bump: release[3] });
	}
	return releases;
}

/**
 * The problems with a change; empty when it passes.
 *
 * @param {{
 *   changed: readonly string[],
 *   changesets: readonly ChangesetFile[],
 *   packages: Map<string, WorkspacePackage>,
 *   ignored: ReadonlySet<string>,
 *   bumped?: ReadonlySet<string>,
 * }} change the files it touches, the changesets it adds, edits or removes, the workspace's packages, what the config ignores, and the apps whose version it moves
 * @returns {string[]} one paragraph per problem
 */
export function checkChange({ changed, changesets, packages, ignored, bumped = new Set() }) {
	/** @type {string[]} */
	const problems = [];
	const apps = versionedApps(packages, ignored);
	for (const pkg of taggedPackages(packages, ignored))
		if (!pkg.dir.startsWith('apps/'))
			problems.push(
				`${pkg.name} carries a version, and .changeset/config.json does not ignore it: a package is never versioned, so ignore it there.`,
			);
	const versioned = new Set(apps.map((app) => app.name));
	const named = new Set();
	let empty = false;
	for (const app of apps)
		if (!app.version)
			problems.push(
				`${app.name} is versioned, but its package.json has no version: give it one, or ignore it in .changeset/config.json.`,
			);
	for (const { file, text, deleted } of changesets) {
		const releases = releasesOf(text);
		if (releases === undefined) {
			if (!deleted)
				problems.push(
					`${file} is not a changeset: it opens with no front matter between --- lines.`,
				);
			continue;
		}
		// Removed, it is consumed only for an app whose version the change moves.
		if (deleted) {
			for (const { name } of releases) if (bumped.has(name)) named.add(name);
			continue;
		}
		if (releases.length === 0) empty = true;
		for (const { name, bump } of releases) {
			if (!versioned.has(name))
				problems.push(
					`${file} names ${name}, which is not released: Changesets versions only ${[...versioned].join(', ') || 'no app'} (.changeset/config.json).`,
				);
			else if (!BUMPS.has(bump))
				problems.push(`${file} gives ${name} the bump "${bump}": it is major, minor or patch.`);
			named.add(name);
		}
	}
	if (empty) return problems;
	for (const app of apps) {
		if (named.has(app.name)) continue;
		const directories = shippedDirectories(app, packages);
		const shipped = changed.filter((file) => ships(file, directories));
		if (shipped.length === 0) continue;
		problems.push(
			[
				`${app.name} ships this change, and no changeset names it:`,
				...shipped.slice(0, MAX_LISTED_FILES).map((file) => `  ${file}`),
				...(shipped.length > MAX_LISTED_FILES
					? [`  … and ${shipped.length - MAX_LISTED_FILES} more`]
					: []),
				'Add one with `pnpm changeset` (what a bump means: AGENTS.md § Before pushing), or `pnpm changeset --empty` for a change no Release should mention.',
			].join('\n'),
		);
	}
	return problems;
}

/** @param {string} cwd */
function gitIn(cwd) {
	/** @param {string[]} args */
	return (args) =>
		execFileSync('git', args, {
			cwd,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
			maxBuffer: 64 * 1024 * 1024,
		});
}

/**
 * What the change touches, measured between `base` and `head`, or between
 * `base` and the working tree (untracked files included) with no `head`.
 *
 * @param {(args: string[]) => string} git
 * @param {string} root
 * @param {string} base
 * @param {string} [head]
 * @param {Map<string, WorkspacePackage>} packages
 * @returns {{ changed: string[], changesets: ChangesetFile[], bumped: Set<string> }} the files, the changesets with their text, and the apps whose version moved
 */
function measure(git, root, base, head, packages) {
	const lines = git(['diff', '--name-status', '--no-renames', base, ...(head ? [head] : [])])
		.split('\n')
		.filter(Boolean)
		.map((line) => {
			const [status = '', file = ''] = line.split('\t');
			return { status, file };
		});
	if (!head)
		for (const file of git(['ls-files', '--others', '--exclude-standard']).split('\n'))
			if (file) lines.push({ status: 'A', file });
	const changesets = lines
		.filter(({ file }) => CHANGESET.test(file))
		.map(({ status, file }) => ({
			file,
			deleted: status === 'D',
			text:
				status === 'D'
					? git(['show', `${base}:${file}`])
					: head
						? git(['show', `${head}:${file}`])
						: readFileSync(join(root, file), 'utf8'),
		}));
	/** @param {string} text */
	const versionOf = (text) => {
		try {
			return JSON.parse(text).version;
		} catch {
			return undefined;
		}
	};
	const changed = lines.map(({ file }) => file);
	const bumped = new Set();
	for (const pkg of packages.values()) {
		const manifest = `${pkg.dir}/package.json`;
		if (!changed.includes(manifest)) continue;
		/** @param {string | undefined} rev the revision, or the working tree */
		const at = (rev) => {
			try {
				return versionOf(
					rev ? git(['show', `${rev}:${manifest}`]) : readFileSync(join(root, manifest), 'utf8'),
				);
			} catch {
				return undefined;
			}
		};
		const after = at(head);
		if (after !== undefined && after !== at(base)) bumped.add(pkg.name);
	}
	return { changed, changesets, bumped };
}

function main() {
	const cwd = process.cwd();
	const root = gitIn(cwd)(['rev-parse', '--show-toplevel']).trim();
	const git = gitIn(root);
	const eventName = process.env.GITHUB_EVENT_NAME ?? '';
	/** @type {{ base: string, head?: string } | undefined} */
	let range;
	if (eventName) {
		const event = process.env.GITHUB_EVENT_PATH
			? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
			: {};
		range = diffRange(eventName, event);
	} else {
		const base = changeBase({ cwd: root });
		range = base && { base: base.commit };
	}
	if (!range) {
		console.error(
			`changeset check: nothing to measure ${eventName ? `a ${eventName} event` : 'this checkout'} against, so it cannot tell which apps the change ships in.`,
		);
		process.exitCode = 1;
		return;
	}
	const packages = workspacePackages(root);
	const problems = checkChange({
		...measure(git, root, range.base, range.head, packages),
		packages,
		ignored: ignoredPackages(root),
	});
	if (problems.length === 0) {
		console.log('changeset check: every app this change ships in is named in a changeset.');
		return;
	}
	for (const problem of problems)
		console.error(
			eventName ? `::error title=Changeset::${problem.replaceAll('\n', '%0A')}` : problem,
		);
	process.exitCode = 1;
}

// `import.meta.main`: run as a workspace bin, `argv[1]` names the linked path.
if (import.meta.main) main();
