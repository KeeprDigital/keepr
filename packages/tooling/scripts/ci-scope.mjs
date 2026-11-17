/**
 * CI's `scope` job ("Decide what the change can affect"): which of CI's jobs
 * a change can affect, so a docs-only change skips the code gates, running
 * only what they check of a document, and CI builds the Worker of only each
 * deployable app the change ships in (.github/workflows/ci.yml).
 *
 * A skipped gate is only safe when what it would have checked is unchanged
 * from a revision that already passed it, so the change is always measured
 * against the revision it lands on (ADR-0036):
 *
 * - **A PR** (`pull_request`): its test merge commit against that commit's
 *   first parent, the base branch's tip. This is PR feedback; the queue's
 *   run is what lands.
 * - **A merge group** (`merge_group`): the queue's base, the main revision the
 *   group lands on, against the group's head, the exact tree that lands. Not
 *   `HEAD^1`: a group holding several squashed PRs has one commit per PR above
 *   its base, so the first parent would measure only the last of them.
 *
 * Anything it cannot tell runs everything: another event, a malformed event,
 * a failed fetch or diff, an empty diff.
 *
 * A merge group whose tree is byte-identical to one a full, green PR run of
 * CI verified skips every gate: what they would check passed already, on
 * exactly this tree (scripts/ci-reuse.mjs). It then appends `verified-by=`,
 * that run's URL. Without that exact match, or when it cannot tell, the
 * group is scoped as above.
 *
 *   node packages/tooling/scripts/ci-scope.mjs
 *     (reads GITHUB_EVENT_NAME, GITHUB_EVENT_PATH, and in a merge group
 *     GITHUB_REPOSITORY, GITHUB_REPOSITORY_ID and GH_TOKEN; appends code=,
 *     docs=, apps= and, on reuse, verified-by= to GITHUB_OUTPUT)
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { verifiedRunOnGitHub } from './ci-reuse.mjs';
import { servicesBindKeeprAccounts } from './deploy/order.mjs';
import { deployableApps } from './deploy/release.mjs';
import { parseJsonc } from './jsonc.mjs';
import { shippedDirectories, ships } from './shipped-code.mjs';
import { workspacePackages } from './versioned-apps.mjs';

/**
 * Docs, editor settings and Dependabot's config. Every workflow is code: each
 * is held by unit tests of its wiring (ciWorkflows.test.ts,
 * deployPromotion.test.ts), which only run if CI does.
 */
const OUTSIDE_CODE = /\.md$|^\.vscode\/|^\.github\/dependabot\.yml$/;
/**
 * What the code gates check outside the code: the documentation test follows
 * every document's links. A change that skips those gates still runs that
 * much (`pnpm verify:docs`).
 */
const DOCUMENT = /\.md$/;
/**
 * What builds every app's Worker leg, though no app ships it: CI's own
 * workflow and setup, the tooling the leg runs, the Node and pnpm the root
 * manifest pins, and the packages' compiler options.
 */
const BUILDS_EVERY_LEG =
	/^(?:\.github\/workflows\/ci\.yml|\.github\/actions\/setup\/.+|packages\/tooling\/.+|package\.json|tsconfig\.base\.json)$/;
/** What an app binding Keepr Accounts runs its leg against (ADR-0113). */
const STAND_IN = '@keepr/accounts-stand-in';

const COMMIT_ID = /^[0-9a-f]{40}$/;

/**
 * @param {readonly string[]} changedFiles repository-relative paths
 * @returns {{ code: boolean, docs: boolean }} whether any file can affect the code gates; and whether a change that skips them touches a document
 */
export function scopeOf(changedFiles) {
	if (changedFiles.length === 0) return { code: true, docs: false };
	const code = changedFiles.some((file) => !OUTSIDE_CODE.test(file));
	// The code gates cover every document themselves.
	const docs = !code && changedFiles.some((file) => DOCUMENT.test(file));
	return { code, docs };
}

/**
 * @typedef {{ app: string, accounts: boolean }} WorkerLeg
 *   a deployable app, and whether it binds Keepr Accounts, so its leg runs
 *   against the Accounts Stand-in
 * @typedef {{
 *   apps: readonly WorkerLeg[],
 *   packages: Map<string, import('./versioned-apps.mjs').WorkspacePackage>,
 * }} DeployableWorkspace
 */

/**
 * The deployable apps whose Worker leg a change runs: each it ships in
 * (`shipped-code.mjs`), each the stand-in it runs against changes for, and
 * every one for what builds every leg. An app whose package it cannot read
 * runs for any change to the code; nothing it can tell runs every one.
 *
 * @param {readonly string[]} changedFiles repository-relative paths
 * @param {DeployableWorkspace} workspace
 * @returns {WorkerLeg[]} the legs, in the workspace's order
 */
export function workerLegsOf(changedFiles, { apps, packages }) {
	if (changedFiles.length === 0) return [...apps];
	const code = changedFiles.filter((file) => !OUTSIDE_CODE.test(file));
	if (code.some((file) => BUILDS_EVERY_LEG.test(file))) return [...apps];
	const byDirectory = new Map([...packages.values()].map((pkg) => [pkg.dir, pkg]));
	const standIn = packages.get(STAND_IN);
	return apps.filter(({ app, accounts }) => {
		const pkg = byDirectory.get(`apps/${app}`);
		if (!pkg) return code.length > 0;
		const directories = [
			...shippedDirectories(pkg, packages),
			...(accounts && standIn ? shippedDirectories(standIn, packages) : []),
		];
		return code.some((file) => ships(file, directories));
	});
}

/**
 * Whether an app's source Wrangler configuration binds Keepr Accounts, at its
 * top level or in any Environment's block: the scope runs before any build,
 * so it cannot read the built one a deploy's order check does
 * (`deploy/order.mjs`).
 *
 * @param {{ services?: unknown, env?: Record<string, { services?: unknown }> }} config a parsed `wrangler.jsonc`
 */
export function configBindsKeeprAccounts(config) {
	return [config, ...Object.values(config.env ?? {})].some((block) =>
		servicesBindKeeprAccounts(block?.services),
	);
}

/**
 * The checkout's deployable apps (those with a deploy descriptor), each with
 * whether its `wrangler.jsonc` binds Keepr Accounts, and its packages. A
 * checkout with no `apps/` has none.
 *
 * @param {string} root the repository's root
 * @returns {DeployableWorkspace}
 */
function deployableWorkspace(root) {
	/** @type {string[]} */
	let names = [];
	try {
		names = deployableApps(root);
	} catch (error) {
		if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error;
	}
	const apps = names.map((app) => {
		let config = {};
		try {
			config = parseJsonc(readFileSync(join(root, 'apps', app, 'wrangler.jsonc'), 'utf8'));
		} catch (error) {
			if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error;
		}
		return { app, accounts: configBindsKeeprAccounts(config) };
	});
	return { apps, packages: workspacePackages(root) };
}

/**
 * The revisions to diff for this event, and a commit to fetch first, or
 * `undefined` when there is nothing trustworthy to measure against.
 *
 * @param {string} eventName GITHUB_EVENT_NAME
 * @param {any} event the parsed GITHUB_EVENT_PATH payload
 * @returns {{ base: string, head: string, fetch?: string } | undefined} the range, or `undefined` to run everything
 */
export function diffRange(eventName, event) {
	if (eventName === 'pull_request') return { base: 'HEAD^1', head: 'HEAD' };
	if (eventName === 'merge_group') {
		const base = event?.merge_group?.base_sha;
		const head = event?.merge_group?.head_sha;
		if (
			typeof base !== 'string' ||
			typeof head !== 'string' ||
			!COMMIT_ID.test(base) ||
			!COMMIT_ID.test(head)
		)
			return undefined;
		// The checkout is the group's head and its parent; the base is further back.
		return { base, head, fetch: base };
	}
	return undefined;
}

/** @param {string[]} args */
function git(args) {
	return execFileSync('git', args, {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'inherit'],
	});
}

async function main() {
	const eventName = process.env.GITHUB_EVENT_NAME ?? '';
	const event = process.env.GITHUB_EVENT_PATH
		? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
		: {};
	const range = diffRange(eventName, event);
	const verified =
		eventName === 'merge_group' && range ? await verifiedRunOnGitHub(range.head) : undefined;
	if (verified) {
		console.log('code=false docs=false apps=[]');
		if (process.env.GITHUB_OUTPUT)
			appendFileSync(
				process.env.GITHUB_OUTPUT,
				`code=false\ndocs=false\napps=[]\nverified-by=${verified.url}\n`,
			);
		return;
	}
	/** @type {string[]} */
	let changed = [];
	if (range === undefined) {
		console.log(
			`No base to measure a ${eventName || 'unknown'} event against: running everything.`,
		);
	} else {
		try {
			if (range.fetch) {
				git(['fetch', '--no-tags', '--depth=1', 'origin', range.fetch]);
			}
			changed = git(['diff', '--name-only', range.base, range.head]).split('\n').filter(Boolean);
			console.log(`Changed between ${range.base} and ${range.head}:\n${changed.join('\n')}`);
		} catch (error) {
			console.log(
				`::warning::Could not diff ${range.base}..${range.head} (${
					error instanceof Error ? error.message : error
				}): running everything.`,
			);
			changed = [];
		}
	}
	const { code, docs } = scopeOf(changed);
	const apps = JSON.stringify(
		workerLegsOf(changed, deployableWorkspace(git(['rev-parse', '--show-toplevel']).trim())),
	);
	console.log(`code=${code} docs=${docs} apps=${apps}`);
	if (process.env.GITHUB_OUTPUT)
		appendFileSync(process.env.GITHUB_OUTPUT, `code=${code}\ndocs=${docs}\napps=${apps}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
