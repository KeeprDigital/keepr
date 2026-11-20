/**
 * CI's `scope` job ("Decide what the change can affect"): which of CI's jobs
 * a change can affect. A gate runs only when the change affects a workspace
 * project it checks (ADR-0147, `project-graph.mjs`); a docs-only change runs
 * only what the gates check of a document; and CI builds the Worker of only
 * each deployable app the change ships in (.github/workflows/ci.yml,
 * ADR-0121).
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
 * a failed fetch or diff, an empty diff, a file in no project.
 *
 * A merge group whose tree is byte-identical to one a green PR run of CI
 * verified skips every gate: what they would check passed already, on
 * exactly this tree (scripts/ci-reuse.mjs). It then appends `verified-by=`,
 * that run's URL. Without that exact match, or when it cannot tell, the
 * group is scoped as above. The group is measured first, so the reuse check
 * knows which jobs the group's own run would skip: a PR run that skipped a
 * job verifies only a group that skips it too (ADR-0123, ADR-0147).
 *
 *   node packages/tooling/scripts/ci-scope.mjs
 *     (reads GITHUB_EVENT_NAME, GITHUB_EVENT_PATH, and in a merge group
 *     GITHUB_REPOSITORY, GITHUB_REPOSITORY_ID and GH_TOKEN; appends code=,
 *     docs=, gates=, apps= and, on reuse, verified-by= to GITHUB_OUTPUT)
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { verifiedRunOnGitHub } from './ci-reuse.mjs';
import { configBindsKeeprAccounts } from './deploy/order.mjs';
import { deployableApps, workerSourceConfig } from './deploy/release.mjs';
import { parseJsonc } from './jsonc.mjs';
import { affectedProjects } from './project-graph.mjs';
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
 * every document's links. A change to a document that skips the gate running
 * that test still runs it, in the Lint job (`pnpm verify:docs`).
 */
const DOCUMENT = /\.md$/;
/**
 * What builds every app's Worker leg, though no app ships it: CI's own
 * workflow and setup, the tooling's scripts the leg runs and the manifest
 * naming them, the Node and pnpm the root manifest pins, and the packages'
 * compiler options. Not the tooling's tests or documents: the leg runs
 * neither.
 */
const BUILDS_EVERY_LEG =
	/^(?:\.github\/workflows\/ci\.yml|\.github\/actions\/setup\/.+|packages\/tooling\/(?:scripts\/.+|package\.json)|package\.json|tsconfig\.base\.json)$/;
/** What an app binding Keepr Accounts runs its leg against (ADR-0113). */
const STAND_IN = '@keepr/accounts-stand-in';

const COMMIT_ID = /^[0-9a-f]{40}$/;

/**
 * CI's gates that check workspace projects, each run only for a change that
 * affects a project it checks (`checks`, matched against the project's
 * directory): its job's id in ci.yml, and the name GitHub reports it under
 * when it is skipped. For a matrix job that is its name's template, since a
 * job skipped by its condition never expands its matrix (ADR-0123). The Lint
 * job checks the whole workspace and runs for every change to the code.
 * ciWorkflows.test.ts holds each entry to ci.yml.
 *
 * @type {readonly { job: string, name: string, checks: RegExp }[]}
 */
export const PROJECT_GATES = [
	{ job: 'typecheck', name: 'Typecheck', checks: /^apps\/stream$/ },
	{ job: 'unit', name: 'Unit suite', checks: /^apps\/stream$/ },
	{ job: 'nuxt', name: 'Nuxt suite', checks: /^apps\/stream$/ },
	{
		job: 'integration',
		name: 'Integration suite (${{ matrix.shard }}/2)',
		checks: /^apps\/stream$/,
	},
	{ job: 'server-and-browser', name: 'Browser gates', checks: /^apps\/stream$/ },
	{ job: 'packages', name: 'Packages', checks: /^packages\// },
	{ job: 'score', name: 'Score Keepr', checks: /^apps\/score$/ },
	{ job: 'accounts', name: 'Keepr Accounts', checks: /^apps\/accounts$/ },
];

/**
 * The gate whose suite holds the documentation test (`pnpm verify:docs`).
 * When it does not run, a change to a document runs that test in the Lint
 * job instead.
 */
const DOCUMENTATION_TEST_GATE = 'unit';

/**
 * CI's Worker job (`worker-guard`) as GitHub names it when its scope chose no
 * leg: skipped before its matrix expanded, so with the name's template
 * unexpanded. A leg that ran or was skipped names its app instead
 * (ADR-0123). ciWorkflows.test.ts holds it to ci.yml.
 */
export const NO_LEG_WORKER_JOB = 'Build, wrangler dry runs, and Worker smoke (${{ matrix.app }})';

/** @typedef {import('./versioned-apps.mjs').WorkspacePackage} WorkspacePackage */

/**
 * @param {readonly string[]} changedFiles repository-relative paths
 * @param {Map<string, WorkspacePackage>} packages the workspace's packages, by name
 * @returns {{ code: boolean, docs: boolean, gates: string[] }} whether any file can affect the code gates; whether the Lint job runs the documentation test, because a document changed and the gate that runs it does not; and the project gates to run, by job id
 */
export function scopeOf(changedFiles, packages) {
	const codeFiles = changedFiles.filter((file) => !OUTSIDE_CODE.test(file));
	// No diff, or no workspace to place it in: nothing it can tell. CI's own
	// workflow and setup are in no project, so they run every gate.
	const everything = changedFiles.length === 0 || packages.size === 0;
	const code = everything || codeFiles.length > 0;
	/** @type {(gate: (typeof PROJECT_GATES)[number]) => boolean} */
	let runs = () => everything;
	if (!everything && code) {
		const affected = [...affectedProjects(codeFiles, packages)].map(
			(name) => /** @type {WorkspacePackage} */ (packages.get(name)).dir,
		);
		runs = ({ checks }) => affected.some((dir) => checks.test(dir));
	}
	const gates = PROJECT_GATES.filter(runs).map(({ job }) => job);
	const docs =
		!gates.includes(DOCUMENTATION_TEST_GATE) && changedFiles.some((file) => DOCUMENT.test(file));
	return { code, docs, gates };
}

/**
 * What the group's own run would skip, by the names GitHub reports skipped
 * jobs under: each project gate it does not run, and the Worker job when it
 * runs no leg. A PR run whose skipped jobs are all among them left out
 * nothing the group's run would check (`ci-reuse.mjs`).
 *
 * @param {{ gates: readonly string[], apps: readonly unknown[] }} scope
 * @returns {string[]} the job names
 */
export function skippedJobs({ gates, apps }) {
	return [
		...PROJECT_GATES.filter(({ job }) => !gates.includes(job)).map(({ name }) => name),
		...(apps.length === 0 ? [NO_LEG_WORKER_JOB] : []),
	];
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

export { configBindsKeeprAccounts };

/**
 * What `read` answers, or `fallback` when what it reads does not exist.
 *
 * @template T
 * @param {() => T} read
 * @param {T} fallback
 * @returns {T}
 */
function unlessMissing(read, fallback) {
	try {
		return read();
	} catch (error) {
		if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error;
		return fallback;
	}
}

/**
 * The checkout's deployable apps (those with a deploy descriptor), each with
 * whether its Worker's source configuration (the descriptor's `worker.source`)
 * binds Keepr Accounts, and its packages. A checkout with no `apps/` has none;
 * an app whose source configuration is missing binds nothing. Not the
 * descriptor's `worker.config`: that is the built Worker's, and the scope runs
 * before anything is built.
 *
 * @param {string} root the repository's root
 * @returns {DeployableWorkspace}
 */
function deployableWorkspace(root) {
	const apps = unlessMissing(() => deployableApps(root), /** @type {string[]} */ ([])).map(
		(app) => ({
			app,
			accounts: configBindsKeeprAccounts(
				unlessMissing(() => parseJsonc(readFileSync(workerSourceConfig(root, app), 'utf8')), {}),
			),
		}),
	);
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

/**
 * @param {string} cwd
 * @param {string[]} args
 */
function git(cwd, args) {
	return execFileSync('git', args, {
		cwd,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'inherit'],
	});
}

/**
 * @typedef {(head: string, group: { skipped: readonly string[] }) => Promise<{ id: number, url: string } | undefined>} VerifiedRun
 *   the PR run that already verified the tree of `head`, if one did (`verifiedRunOnGitHub`)
 */

/**
 * The scope job's decision for this event in the checkout at `cwd`. A merge
 * group is measured first, so the reuse check knows which jobs the group's
 * own run would skip: a PR run that skipped a job verifies only a group that
 * skips it too (ADR-0123, ADR-0147).
 *
 * @param {{ eventName: string, event: any, cwd: string, verifiedRun: VerifiedRun }} options
 * @returns {Promise<{ code: boolean, docs: boolean, gates: string[], apps: WorkerLeg[], verifiedBy: string | undefined }>}
 */
export async function scope({ eventName, event, cwd, verifiedRun }) {
	const range = diffRange(eventName, event);
	/** @type {string[]} */
	let changed = [];
	if (range === undefined) {
		console.log(
			`No base to measure a ${eventName || 'unknown'} event against: running everything.`,
		);
	} else {
		try {
			if (range.fetch) {
				git(cwd, ['fetch', '--no-tags', '--depth=1', 'origin', range.fetch]);
			}
			changed = git(cwd, ['diff', '--name-only', range.base, range.head])
				.split('\n')
				.filter(Boolean);
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
	const workspace = deployableWorkspace(git(cwd, ['rev-parse', '--show-toplevel']).trim());
	const { code, docs, gates } = scopeOf(changed, workspace.packages);
	const apps = workerLegsOf(changed, workspace);
	const verified =
		eventName === 'merge_group' && range
			? await verifiedRun(range.head, { skipped: skippedJobs({ gates, apps }) })
			: undefined;
	if (verified) return { code: false, docs: false, gates: [], apps: [], verifiedBy: verified.url };
	return { code, docs, gates, apps, verifiedBy: undefined };
}

async function main() {
	const { code, docs, gates, apps, verifiedBy } = await scope({
		eventName: process.env.GITHUB_EVENT_NAME ?? '',
		event: process.env.GITHUB_EVENT_PATH
			? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
			: {},
		cwd: process.cwd(),
		verifiedRun: verifiedRunOnGitHub,
	});
	const outputs = `code=${code}\ndocs=${docs}\ngates=${JSON.stringify(gates)}\napps=${JSON.stringify(apps)}\n${
		verifiedBy ? `verified-by=${verifiedBy}\n` : ''
	}`;
	console.log(outputs.trim().replaceAll('\n', ' '));
	if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, outputs);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
