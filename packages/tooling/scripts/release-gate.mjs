/**
 * The release gate, the first half of the release workflow's publish script
 * (.github/workflows/release.yml): Changesets tags a Release only on a
 * revision the merge queue verified (ADR-0036, ADR-0118).
 *
 * Once a merged Version PR leaves no changeset on `main`, `changesets/action`
 * runs the publish script: this gate, then `changeset git-tag`, which tags
 * `HEAD` as `<app>@<version>` for each versioned app whose version has no
 * tag yet (each package the config does not ignore that has a version: only
 * apps, which the changeset check holds), and the action makes a GitHub Release of each tag it reports.
 * Through the merge queue, `HEAD` is the merge group's head: the exact tree CI
 * ran on before it landed, as a `merge_group` run on that commit id. A Version
 * PR merged any other way (a ruleset bypass) landed a tree nothing verified,
 * so this refuses before anything is tagged, and no tag, GitHub Release or
 * Deploy candidate is made from it.
 *
 * A `merge_group` run that skipped its gates because the tree is
 * byte-identical to one a full, green PR run verified (scripts/ci-reuse.mjs)
 * counts as that verification. The guarantee is tree equality with a full
 * green run of CI, and the tree carries CI's own workflow and scripts.
 *
 * `changeset git-tag` tags `HEAD`, so `HEAD` must be the commit that set each
 * version it tags (`versionCommit`). A Version PR merged in one queue push
 * with another PR, a superseded pending run of this workflow, or a manual
 * retry after `main` moved each leaves `HEAD` past that commit: the gate
 * refuses, naming the commit to tag by hand, rather than tag another tree.
 *
 * It refuses only when there is a tag to create. With none, publishing tags
 * nothing, and there is nothing to refuse.
 *
 *   node packages/tooling/scripts/release-gate.mjs
 *     (reads GITHUB_REPOSITORY; checks HEAD, the commit `changeset git-tag` tags; uses `git` and `gh`)
 */

import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { ignoredPackages, taggedPackages, workspacePackages } from './versioned-apps.mjs';

const CI_WORKFLOW = '.github/workflows/ci.yml';
/** Two minutes of 10s reads: far longer than a finished run takes to conclude. */
const DEFAULT_ATTEMPTS = 12;
const RETRY_DELAY_MS = 10_000;

/** @param {number} ms */
function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @typedef {{ event: string, path: string, head_sha: string, conclusion: string | null }} WorkflowRun
 * @typedef {import('./versioned-apps.mjs').WorkspacePackage} WorkspacePackage
 */

/**
 * The tags `changeset git-tag` would create: each tagged package's
 * `<name>@<version>` that is not a tag yet.
 *
 * @param {readonly WorkspacePackage[]} apps what it tags (`taggedPackages`), each with a version
 * @param {ReadonlySet<string>} existing the repository's tags
 * @returns {string[]} the tags still to create
 */
export function pendingTags(apps, existing) {
	return apps.map((app) => `${app.name}@${app.version}`).filter((tag) => !existing.has(tag));
}

/**
 * The problems with tagging `commit`; empty when there is nothing to tag, or
 * when it passed CI in the merge queue.
 *
 * The queue merges once the `CI passed` check succeeds, a moment before its
 * workflow run concludes, so a merge-group CI run on the commit that is still
 * going is waited for, up to `attempts` reads.
 *
 * @param {{ tags: readonly string[], commit: string, setBy?: ReadonlyMap<string, string> }} release the tags it would create, the commit they would name, and the commit that set each tag's version
 * @param {(sha: string) => Promise<readonly WorkflowRun[]>} runsFor the workflow runs on a commit
 * @param {{ attempts?: number, wait?: (ms: number) => Promise<void> }} [options] how long to wait for an unfinished run
 * @returns {Promise<string[]>} the refusal, if any
 */
export async function checkRelease(
	{ tags, commit, setBy = new Map() },
	runsFor,
	{ attempts = DEFAULT_ATTEMPTS, wait = sleep } = {},
) {
	if (tags.length === 0) return [];
	const moved = tags.flatMap((tag) => {
		const setter = setBy.get(tag);
		return setter && setter !== commit
			? [
					`${tag} would tag ${commit}, but its version was set by ${setter}: tag that commit by hand (apps/stream/README.md § Releases).`,
				]
			: [];
	});
	if (moved.length > 0) return moved;
	let verified = false;
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		const queueRuns = (await runsFor(commit)).filter(
			(run) => run.event === 'merge_group' && run.path === CI_WORKFLOW && run.head_sha === commit,
		);
		verified = queueRuns.some((run) => run.conclusion === 'success');
		if (verified || !queueRuns.some((run) => run.conclusion === null) || attempt === attempts)
			break;
		await wait(RETRY_DELAY_MS);
	}
	return verified
		? []
		: [`${tags.join(', ')} would tag ${commit}, which no successful merge-queue CI run verified.`];
}

/**
 * The commit that set the version `manifest` holds at `HEAD`: the latest to
 * change its `version`, whatever else touched the file since.
 *
 * @param {string} cwd the repository
 * @param {string} manifest the app's `package.json`, from the repository's root
 * @returns {string | undefined} the commit, or `undefined` when no commit set it
 */
export function versionCommit(cwd, manifest) {
	/** @param {string[]} args */
	const git = (args) =>
		execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
	/** @param {string} rev */
	const versionAt = (rev) => {
		try {
			return JSON.parse(git(['show', `${rev}:${manifest}`])).version;
		} catch {
			return undefined;
		}
	};
	// A shallow clone reads its oldest commit's parent as missing, so its own HEAD would seem to set the version.
	if (git(['rev-parse', '--is-shallow-repository']).trim() === 'true')
		throw new Error(
			'which commit set a version needs the full history, and this checkout is shallow.',
		);
	const commits = git(['log', '--format=%H', 'HEAD', '--', manifest]).split('\n').filter(Boolean);
	for (const commit of commits) if (versionAt(commit) !== versionAt(`${commit}^`)) return commit;
	return undefined;
}

/** @param {string[]} args */
function gh(args) {
	return JSON.parse(execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
}

async function main() {
	const repository = process.env.GITHUB_REPOSITORY ?? '';
	const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
	const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
	const existing = new Set(
		execFileSync('git', ['tag', '--list'], { encoding: 'utf8' }).split('\n').filter(Boolean),
	);
	const apps = taggedPackages(workspacePackages(root), ignoredPackages(root));
	const tags = pendingTags(apps, existing);
	const setBy = new Map(
		apps.flatMap((app) => {
			const setter = versionCommit(root, `${app.dir}/package.json`);
			return setter ? [[`${app.name}@${app.version}`, setter]] : [];
		}),
	);
	const problems = await checkRelease(
		{ tags, commit, setBy },
		async (sha) =>
			gh(['api', `repos/${repository}/actions/runs?head_sha=${sha}&event=merge_group&per_page=100`])
				.workflow_runs,
	);
	if (problems.length === 0) {
		console.log(
			tags.length === 0
				? 'Every versioned app is tagged at its version: nothing to release.'
				: `${tags.join(', ')} on ${commit}, which passed CI in the merge queue.`,
		);
		return;
	}
	for (const problem of problems)
		console.log(
			`::error title=Release refused::${problem} Releases are cut only from a revision the merge queue verified (apps/stream/README.md § Releases).`,
		);
	process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
