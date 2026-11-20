import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { NO_LEG_WORKER_JOB, PROJECT_GATES } from '../scripts/ci-scope.mjs';
import { isConventionalTitle } from '../scripts/conventional-title.mjs';
import { deployableApps } from '../scripts/deploy/release.mjs';
import { workspacePackages } from '../scripts/versioned-apps.mjs';

/**
 * The merge queue (ADR-0036) is only as good as the workflows' wiring: these read
 * the committed workflows. Nothing runs against GitHub; only a queued merge proves
 * the events arrive.
 */

interface Step {
	id?: string;
	name?: string;
	uses?: string;
	run?: string;
	if?: string;
	'continue-on-error'?: unknown;
	env?: Record<string, string>;
	with?: Record<string, unknown>;
}
interface Job {
	name?: string;
	needs?: string | string[];
	if?: string;
	environment?: { name: string } | string;
	permissions?: Record<string, string>;
	outputs?: Record<string, string>;
	strategy?: { matrix?: Record<string, unknown> };
	defaults?: { run?: { 'working-directory'?: string } };
	steps?: Step[];
	'continue-on-error'?: unknown;
}
interface Workflow {
	on: Record<string, { types?: string[] } | null>;
	permissions?: Record<string, string>;
	jobs: Record<string, Job>;
}

function workflow(name: string): Workflow {
	return parse(readFileSync(`../../.github/workflows/${name}`, 'utf8')) as Workflow;
}

/** The `main` ruleset's required status checks: job names, as GitHub reports them. */
const REQUIRED_CHECKS = ['CI passed', 'Conventional Commit title'];

const ci = workflow('ci.yml');
const prTitle = workflow('pr-title.yml');
const release = workflow('release.yml');
const rootScripts = (
	JSON.parse(readFileSync('../../package.json', 'utf8')) as { scripts: Record<string, string> }
).scripts;
const changesetConfig = JSON.parse(readFileSync('../../.changeset/config.json', 'utf8')) as {
	changelog: unknown;
};
const gates = Object.keys(ci.jobs).filter((id) => !['scope', 'record', 'passed'].includes(id));
const FOR_CODE = "needs.scope.outputs.code == 'true'";
const FOR_DOCS = "needs.scope.outputs.docs == 'true'";
/** The Worker legs: one per deployable app the change ships in; none when it ships in none. */
const FOR_WORKERS = "needs.scope.outputs.apps != '[]'";
/** A gate that checks projects: when the change affects one of them (ADR-0147). */
const forGate = (job: string) => `contains(fromJSON(needs.scope.outputs.gates), '${job}')`;
/** Every project's directory, as the scope places a change in it. */
const projects = [...workspacePackages('../..').values()].map((pkg) => pkg.dir);

/** The directories a root command's `pnpm --filter "./dir"` or `"./parent/{a,b}"` selects, sorted. */
function filtered(command: string) {
	const [, parent, list, single] =
		/^pnpm --filter "\.\/(?:([\w/-]+)\/\{([\w,-]+)\}|([\w/-]+))" /.exec(command) ?? [];
	if (single) return [single];
	return (list ?? '')
		.split(',')
		.filter(Boolean)
		.map((name) => `${parent}/${name}`)
		.toSorted();
}

function needs(job: Job) {
	return [job.needs ?? []].flat().toSorted();
}

function runs(job: Job) {
	return (job.steps ?? [])
		.map((step) => step.run)
		.filter(Boolean)
		.join('\n');
}

describe('every required check reports in the merge queue as well as on PRs', () => {
	it.each([
		['ci.yml', ci],
		['pr-title.yml', prTitle],
	])('%s runs on merge groups and on PRs', (_, file) => {
		expect(file.on.merge_group).toEqual({
			types: ['checks_requested'],
		});
		expect(file.on).toHaveProperty('pull_request');
	});

	it('names each required check exactly once, as a job of a workflow that runs in the queue', () => {
		const names = [ci, prTitle].flatMap((file) => Object.values(file.jobs).map((job) => job.name));

		for (const check of REQUIRED_CHECKS)
			expect(names.filter((name) => name === check)).toHaveLength(1);
	});

	it("`CI passed` waits on every other CI job, whatever became of it, and judges each result but `record`'s", () => {
		const passed = ci.jobs.passed!;

		expect(passed.name).toBe('CI passed');
		expect(passed.if).toBe('always()');
		expect(needs(passed)).toEqual(
			Object.keys(ci.jobs)
				.filter((id) => id !== 'passed')
				.toSorted(),
		);
		expect(passed.steps).toHaveLength(1);
		expect(passed.steps![0]!.env).toEqual({
			NEEDS: '${{ toJSON(needs) }}',
			CODE: '${{ needs.scope.outputs.code }}',
			VERIFIED_BY: '${{ needs.scope.outputs.verified-by }}',
		});
	});

	/**
	 * `CI passed`'s own shell, run as GitHub runs a step (`bash -eo pipefail`)
	 * over the results its `needs` hold. Every job succeeded unless a case says
	 * otherwise.
	 */
	function ciPassed(
		results: Record<string, string>,
		{ code = 'true', verifiedBy = '' }: { code?: string; verifiedBy?: string } = {},
	) {
		const ids = Object.keys(ci.jobs).filter((id) => id !== 'passed');
		const needs = Object.fromEntries(
			ids.map((id) => [id, { result: results[id] ?? 'success', outputs: {} }]),
		);
		const result = spawnSync(
			'bash',
			['--noprofile', '--norc', '-eo', 'pipefail', '-c', runs(ci.jobs.passed!)],
			{
				encoding: 'utf8',
				env: {
					PATH: process.env.PATH,
					NEEDS: JSON.stringify(needs),
					CODE: code,
					VERIFIED_BY: verifiedBy,
				},
			},
		);
		return { passed: result.status === 0, output: `${result.stdout}${result.stderr}` };
	}

	const skippedGates = Object.fromEntries(gates.map((id) => [id, 'skipped']));

	it.each<[string, Record<string, string>, { code?: string; verifiedBy?: string }, boolean]>([
		['every job passed', {}, {}, true],
		['a gate failed', { 'stream-unit': 'failure' }, {}, false],
		['a gate was cancelled', { tooling: 'cancelled' }, {}, false],
		['only the record failed', { record: 'failure' }, {}, true],
		[
			'a docs-only change skipped every gate',
			{ ...skippedGates, record: 'skipped' },
			{ code: 'false' },
			true,
		],
		[
			'a merge group a PR run verified skipped every gate',
			{ ...skippedGates, record: 'skipped' },
			{ verifiedBy: 'https://ci.example/runs/1' },
			true,
		],
		['code changed and no gate or lint ran', { ...skippedGates, record: 'skipped' }, {}, false],
		[
			'code changed and the lint ran but no gate',
			{ ...skippedGates, checks: 'success' },
			{},
			false,
		],
		['code changed and a gate ran but not the lint', { checks: 'skipped' }, {}, false],
		[
			'a draft PR: the scope itself skipped',
			{ ...skippedGates, scope: 'skipped', record: 'skipped' },
			{ code: '' },
			true,
		],
	])('`CI passed`: %s', (_case, results, scope, expected) => {
		const { passed, output } = ciPassed(results, scope);

		expect(passed, output).toBe(expected);
	});

	it('`Conventional Commit title` has no condition that could skip it in the queue', () => {
		const job = prTitle.jobs.conventional!;

		expect(job.if).toBeUndefined();
		expect((job.steps ?? []).every((step) => step.if === undefined)).toBe(true);
		expect(runs(job)).toBe('node packages/tooling/scripts/conventional-title.mjs');
		// The title is contributor-controlled, so only the script reads it, from the payload.
		expect(JSON.stringify(prTitle)).not.toContain('github.event.pull_request.title');
	});
});

describe("the CI scope decides what a merge group can affect against the queue's base", () => {
	const scope = ci.jobs.scope!;

	it('runs for every merge group and for ready PRs, through the tested script', () => {
		expect(scope.if).toBe("github.event_name == 'merge_group' || !github.event.pull_request.draft");
		expect(runs(scope)).toContain('node packages/tooling/scripts/ci-scope.mjs');
	});

	// An output the scope job does not export reads as '', which skips the job asking for it.
	it('exports every output another job reads, each from a step it runs', () => {
		const read = [
			...new Set(
				[...JSON.stringify(ci.jobs).matchAll(/needs\.scope\.outputs\.([\w-]+)/g)].map(
					(match) => match[1]!,
				),
			),
		];
		const stepIds = (scope.steps ?? []).map((step) => step.id);

		expect(read.length).toBeGreaterThan(0);
		expect(Object.keys(scope.outputs ?? {})).toEqual(expect.arrayContaining(read));
		for (const [name, expression] of Object.entries(scope.outputs ?? {})) {
			const [, stepId] = expression.match(/^\$\{\{ steps\.([\w-]+)\.outputs\.[\w-]+ \}\}$/) ?? [];
			expect({
				name,
				fromItsStep: stepIds.includes(stepId),
			}).toEqual({ name, fromItsStep: true });
		}
	});

	// The Workspace checks job checks the whole workspace; every other gate is a project gate or the Worker job.
	it.each(gates)(
		"gate %s is skipped only on the scope job's decision, and reads no PR-only state",
		(id) => {
			const job = ci.jobs[id]!;
			const conditions: Record<string, string> = {
				checks: `${FOR_CODE} || ${FOR_DOCS}`,
				'worker-guard': FOR_WORKERS,
				...Object.fromEntries(PROJECT_GATES.map((gate) => [gate.job, forGate(gate.job)])),
			};

			expect(job.needs).toBe('scope');
			expect(job.if).toBe(conditions[id]);
			expect(JSON.stringify(job)).not.toContain('github.event.pull_request');
		},
	);

	// The reuse check knows a skipped gate by the name GitHub reports, its template for a matrix job.
	// The scope runs a gate for the projects it names, and the gate checks exactly those: in the
	// one project's directory, or at the root with every command filtered to them (ADR-0149).
	it.each(PROJECT_GATES)(
		'project gate $job is named as GitHub reports it skipped, and checks where it runs',
		({ job, name, checks }) => {
			const gate = ci.jobs[job]!;
			const directory = gate.defaults?.run?.['working-directory'];
			const checked = projects.filter((dir) => checks.test(dir)).toSorted();

			expect(gate.name).toBe(name);
			if (directory) expect(checked).toEqual([directory]);
			else
				for (const command of runs(gate).split('\n'))
					expect({ command, filtered: filtered(command) }).toEqual({ command, filtered: checked });
		},
	);

	// A project no gate checks would never be typechecked or tested, whatever the change.
	it('checks every project of the workspace in some project gate', () => {
		expect(projects.filter((dir) => !PROJECT_GATES.some(({ checks }) => checks.test(dir)))).toEqual(
			[],
		);
	});

	// A change that skips Stream Keepr's Unit suite skips its documentation test, so `checks` runs
	// it instead. The workflows are code, so their two linters run with the lint. Every step
	// past the changeset check runs on one of the two: one with no condition is missing here.
	it('the Workspace checks check the changesets always, lint the code and the workflows only for code, and run the docs checks only when the scope asks, all at the root', () => {
		const job = ci.jobs.checks!;
		const [checkout, setup, ...checks] = job.steps ?? [];

		expect(job.name).toBe('Workspace checks');
		expect(JSON.stringify(job)).not.toContain('working-directory');
		expect([checkout?.uses?.replace(/@.*/, ''), setup?.uses]).toEqual([
			'actions/checkout',
			'./.github/actions/setup',
		]);
		expect(
			checks.map((step) => [step.name ?? step.run ?? step.uses?.replace(/@.*/, ''), step.if]),
		).toEqual([
			['Changeset check', undefined],
			['pnpm lint', FOR_CODE],
			['actionlint', FOR_CODE],
			['zizmorcore/zizmor-action', FOR_CODE],
			['pnpm --filter @keepr/stream verify:docs', FOR_DOCS],
		]);
	});

	// One job held all four for 11 to 18 minutes; apart, the longest sets the wall time.
	it('typecheck and the two suites each run in a job of their own', () => {
		const alone = (id: string) =>
			(ci.jobs[id]!.steps ?? []).filter((step) => step.run).map((step) => step.run);

		expect([alone('stream-typecheck'), alone('stream-unit'), alone('stream-nuxt')]).toEqual([
			['pnpm typecheck'],
			['pnpm test:unit:coverage'],
			['pnpm test:nuxt:coverage'],
		]);
	});
});

// ADR-0119: CI builds each deployable app's Worker as its deploy does. An
// app the change does not ship in has no leg, rather than a skipped one, so a
// merge group can still reuse the run (packages/tooling/scripts/ci-reuse.mjs).
describe("CI builds, dry runs and smokes each deployable app's Worker the way its deploy does", () => {
	const worker = ci.jobs['worker-guard']!;

	it('runs one leg per app the scope names, and none when it names none', () => {
		expect(worker.strategy?.matrix).toEqual({
			include: '${{ fromJSON(needs.scope.outputs.apps) }}',
		});
		expect(worker.if).toBe(FOR_WORKERS);
	});

	// The leg builds the app as its deploy does; a build in its project gate would only repeat it.
	it.each(deployableApps('../..'))('builds %s in its Worker leg alone', (app) => {
		const builders = Object.entries(ci.jobs)
			.filter(([, job]) => job.defaults?.run?.['working-directory'] === `apps/${app}`)
			.filter(([, job]) => /^pnpm build\b/m.test(runs(job)))
			.map(([id]) => id);

		expect(builders).toEqual([]);
	});

	// A skipped matrix job keeps its name's template: the reuse check knows it by that name alone.
	it('is named as the reuse check knows it when the scope names no app', () => {
		expect(worker.name).toBe(NO_LEG_WORKER_JOB);
	});

	// The check builds as a deploy builds: the tooling starts the Accounts Stand-in
	// for an app that binds Keepr Accounts (`deploy/build.mjs`), so the leg starts none.
	it("runs the deploy tooling's check at the root, and nothing around it", () => {
		const leg = (worker.steps ?? []).filter((step) => step.run);

		expect(worker.defaults).toBeUndefined();
		expect(leg.map((step) => [step.run, step.env])).toEqual([
			['pnpm exec keepr-deploy check --app "$APP"', { APP: '${{ matrix.app }}' }],
		]);
	});
});

describe('a merge group skips the gates only for a tree a full, green PR run verified', () => {
	const record = ci.jobs.record!;

	// For code every gate runs but the Worker job, which the scope may give no leg (ADR-0123):
	// skipped is no failure, so the implicit success() would not record that run.
	it('a PR run records its tree only after every gate that ran passed, never in the queue or for a fork', () => {
		expect(needs(record)).toEqual(['scope', ...gates].toSorted());
		expect(record.if?.split('&&').map((clause) => clause.trim())).toEqual([
			'!cancelled()',
			"github.event_name == 'pull_request'",
			'github.event.pull_request.head.repo.full_name == github.repository',
			FOR_CODE,
			"!contains(needs.*.result, 'failure')",
			"!contains(needs.*.result, 'cancelled')",
		]);
		expect(runs(record)).toContain('node packages/tooling/scripts/ci-reuse.mjs record');
	});

	it('only the record job can mint an OIDC token, and nothing in CI can write', () => {
		expect(ci.permissions).toEqual({ contents: 'read' });
		for (const [id, job] of Object.entries(ci.jobs)) {
			const writes = Object.entries(job.permissions ?? {})
				.filter(([, level]) => level === 'write')
				.map(([scopeName]) => scopeName);
			expect(writes, id).toEqual(id === 'record' ? ['id-token'] : []);
		}
	});
});

/** The job that versions, gates and tags, and the job that dispatches the Deploy after it. */
const releasing = release.jobs.release!;
const dispatching = release.jobs.deploy!;

describe('the Release workflow tags only what the queue verified', () => {
	const steps = releasing.steps ?? [];
	const changesets = steps.find((step) => step.uses?.startsWith('changesets/action@'));

	it('publishes through the gate, then tags, and nothing lets a tag past a refusal', () => {
		expect(changesets?.with?.['publish-script']).toBe('pnpm release:publish');
		// Only `&&`: a refused gate stops the tagging.
		expect(rootScripts['release:publish']?.split(' && ')).toEqual([
			'node packages/tooling/scripts/release-gate.mjs',
			'changeset git-tag',
		]);
		for (const step of steps) {
			expect(step.if).toBeUndefined();
			expect(step['continue-on-error']).toBeUndefined();
		}
		expect(releasing.if).toBeUndefined();
		expect(releasing['continue-on-error']).toBeUndefined();
	});

	// Changesets core groups a Release by bump; the regroup step after it groups
	// by type, and `.changeset/config.json` names the formatter it reads.
	it('versions through the changelog regroup, with its formatter', () => {
		expect(changesets?.with?.['version-script']).toBe('pnpm release:version');
		expect(rootScripts['release:version']?.split(' && ')).toEqual([
			'changeset version',
			'node packages/tooling/scripts/changelog.mjs',
		]);
		expect(changesetConfig.changelog).toBe('../packages/tooling/scripts/changelog.mjs');
	});

	// The pinned action fails on an input it doesn't declare (v2.1.2 renamed
	// `version` to `version-script`); these are its action.yml inputs at that pin.
	it('passes changesets/action only inputs its pinned version declares', () => {
		const declared = [
			'github-token',
			'publish-script',
			'version-script',
			'commit-message',
			'pr-title',
			'pr-draft',
			'pr-base-branch',
			'create-github-releases',
			'push-git-tags',
			'push-with-git-cli',
			'cwd',
		];

		expect(changesets?.uses).toBe('changesets/action@ae32849d5ba541f9ae29e40e22a623bc13562f51');
		expect(
			Object.keys(changesets?.with ?? {}).filter((input) => !declared.includes(input)),
		).toEqual([]);
	});

	// The Version PR lands as a squash commit like any other, so its title is checked too.
	it('titles the Version PR as a Conventional Commit', () => {
		expect(isConventionalTitle(String(changesets?.with?.['pr-title']))).toBe(true);
	});

	// CI skips a draft, so "ready" means "release exactly this content": every
	// update of the Version PR, a push to main's included, makes it a draft again.
	it('keeps the Version PR a draft, from its opening and after every update, until a person marks it ready', () => {
		expect(changesets?.with?.['pr-draft']).toBe('always');
		expect(ci.on.pull_request?.types).toContain('ready_for_review');
	});
});

// A Release deploys itself: staging, then production behind its approval (ADR-0125).
describe('a Release dispatches one Deploy run, only after tagging, with the apps it released', () => {
	const changesets = (releasing.steps ?? []).find((step) =>
		step.uses?.startsWith('changesets/action@'),
	);
	const steps = dispatching.steps ?? [];
	const dispatch = steps.find((step) => step.run?.includes('scripts/deploy/dispatch.mjs'));

	it('runs after the release job, and only when it published', () => {
		expect(dispatching.needs).toBe('release');
		expect(dispatching.if).toBe("needs.release.outputs.published == 'true'");
		expect(releasing.outputs).toEqual({
			published: `\${{ steps.${changesets?.id}.outputs.published }}`,
			'published-packages': `\${{ steps.${changesets?.id}.outputs.published-packages }}`,
		});
	});

	it('hands the published apps to the tested dispatch script through env, with a token that may only start runs', () => {
		expect(dispatch?.run).toBe('node .deploy-tooling/packages/tooling/scripts/deploy/dispatch.mjs');
		expect(dispatch?.env).toEqual({
			GH_TOKEN: '${{ github.token }}',
			PUBLISHED_PACKAGES: '${{ needs.release.outputs.published-packages }}',
		});
		for (const step of [...steps, ...(releasing.steps ?? [])])
			expect(step.run ?? '').not.toContain('${{');
	});

	// GITHUB_TOKEN's workflow_dispatch starts a run; nothing else in the run may write with it.
	it("gives GITHUB_TOKEN no write but the dispatch job's actions: write", () => {
		expect(release.permissions).toEqual({ contents: 'read', actions: 'read' });
		expect(releasing.permissions).toBeUndefined();
		expect(dispatching.permissions).toEqual({ contents: 'read', actions: 'write' });
		expect(dispatching.environment).toBeUndefined();
	});
});

// A PR opened with GITHUB_TOKEN starts no workflow, and GITHUB_TOKEN can never
// hold `workflows` (ADR-0124).
describe("the Release workflow writes with the release GitHub App's token", () => {
	const job = releasing;
	const steps = job.steps ?? [];
	const mint = steps.findIndex((step) => step.uses?.startsWith('actions/create-github-app-token@'));
	const changesets = steps.findIndex((step) => step.uses?.startsWith('changesets/action@'));

	// The App's key is an environment secret, which only a job in it reads.
	it('runs in the release environment, and its key reaches only the token step', () => {
		expect(Object.keys(release.jobs)).toEqual(['release', 'deploy']);
		expect(job.environment).toBe('release');
		expect(JSON.stringify(dispatching)).not.toContain('secrets.');
		for (const [position, step] of steps.entries())
			if (position !== mint)
				expect(JSON.stringify([step.env, step.with]), step.name ?? step.uses).not.toContain(
					'secrets.',
				);
	});

	it('mints a token narrowed to contents, pull requests and workflows, and opens and tags with it', () => {
		expect(mint).toBeGreaterThanOrEqual(0);
		expect(mint).toBeLessThan(changesets);
		expect(steps[mint]!.with).toEqual({
			'client-id': '${{ secrets.KEEPR_RELEASE_APP_ID }}',
			'private-key': '${{ secrets.KEEPR_RELEASE_APP_PRIVATE_KEY }}',
			'permission-contents': 'write',
			'permission-pull-requests': 'write',
			'permission-workflows': 'write',
		});
		expect(steps[changesets]!.with?.['github-token']).toBe(
			`\${{ steps.${steps[mint]!.id}.outputs.token }}`,
		);
	});

	// The App cannot read Actions runs; the gate reads the merge-group runs with
	// GITHUB_TOKEN, which is all that token may do beyond checking out.
	it('leaves GITHUB_TOKEN reading the contents and the merge-group runs, and the gate using it', () => {
		expect(release.permissions).toEqual({ contents: 'read', actions: 'read' });
		expect(job.permissions).toBeUndefined();
		expect(steps[changesets]!.env).toEqual({ GH_TOKEN: '${{ github.token }}' });
	});
});

// A job that checks out only a few files fails at run time, not in review, if
// the script it runs is not among them.
describe('a job that checks out only some files checks out the script it runs', () => {
	it.each([
		{ file: 'ci.yml', workflow: ci },
		{ file: 'pr-title.yml', workflow: prTitle },
	])('$file', ({ workflow }) => {
		const sparseJobs = Object.entries(workflow.jobs).filter(([, job]) =>
			(job.steps ?? []).some((step) => step.with?.['sparse-checkout'] !== undefined),
		);
		expect(sparseJobs.length).toBeGreaterThan(0);
		for (const [id, job] of sparseJobs) {
			const checkedOut = String(
				job.steps?.find((step) => step.with?.['sparse-checkout'] !== undefined)?.with?.[
					'sparse-checkout'
				],
			)
				.split('\n')
				.map((line) => line.trim())
				.filter(Boolean);
			const scripts = (job.steps ?? []).flatMap(
				(step) => step.run?.match(/(?<=^node )\S+\.mjs/gm) ?? [],
			);
			expect(scripts.length, id).toBeGreaterThan(0);
			for (const script of scripts) expect(checkedOut, id).toContain(script);
		}
	});
});
