import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { NO_LEG_WORKER_JOB } from '../scripts/ci-reuse.mjs';
import { isConventionalTitle } from '../scripts/conventional-title.mjs';

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
	permissions?: Record<string, string>;
	outputs?: Record<string, string>;
	strategy?: { matrix?: Record<string, unknown> };
	defaults?: unknown;
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
const gates = Object.keys(ci.jobs).filter((id) => !['scope', 'record', 'passed'].includes(id));
const FOR_CODE = "needs.scope.outputs.code == 'true'";
const FOR_DOCS = "needs.scope.outputs.docs == 'true'";
/** The Worker legs: one per deployable app the change ships in; none when it ships in none. */
const FOR_WORKERS = "needs.scope.outputs.apps != '[]'";

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
		expect(runs(passed)).toContain('map(select(.key != "record") | .value.result)');
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

	it.each(gates)(
		"gate %s is skipped only on the scope job's decision, and reads no PR-only state",
		(id) => {
			const job = ci.jobs[id]!;

			expect(job.needs).toBe('scope');
			expect(job.if).toBe(
				{ checks: `${FOR_CODE} || ${FOR_DOCS}`, 'worker-guard': FOR_WORKERS }[id] ?? FOR_CODE,
			);
			expect(JSON.stringify(job)).not.toContain('github.event.pull_request');
		},
	);

	// A docs-only change skips the code gates, so `checks` runs what they check of a document instead.
	// The workflows are code, so their two linters run with the lint. Every step
	// past the changeset check runs for exactly one of the two: one with no condition is missing here.
	it('the checks job checks the changesets always, lints the code and the workflows only for code, and runs the docs checks only for a docs-only change', () => {
		const [checkout, setup, ...checks] = ci.jobs.checks!.steps ?? [];

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
			['pnpm verify:docs', FOR_DOCS],
		]);
	});

	// One job held all four for 11 to 18 minutes; apart, the longest sets the wall time.
	it('typecheck and the two suites each run in a job of their own', () => {
		const alone = (id: string) =>
			(ci.jobs[id]!.steps ?? []).filter((step) => step.run).map((step) => step.run);

		expect([alone('typecheck'), alone('unit'), alone('nuxt')]).toEqual([
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

	// A skipped matrix job keeps its name's template: the reuse check knows it by that name alone.
	it('is named as the reuse check knows it when the scope names no app', () => {
		expect(worker.name).toBe(NO_LEG_WORKER_JOB);
	});

	it("runs the deploy tooling's check at the root, against the Accounts Stand-in when the app binds Keepr Accounts", () => {
		const leg = (worker.steps ?? []).filter((step) => step.run);

		expect(worker.defaults).toBeUndefined();
		expect(leg.map((step) => [step.run, step.env])).toEqual([
			[
				'node packages/accounts-stand-in/scripts/stand-in.mjs -- pnpm exec keepr-deploy check --app "$APP"',
				{
					APP: '${{ matrix.app }}',
					KEEPR_ACCOUNTS_STAND_IN: "${{ matrix.accounts && 'on' || 'off' }}",
				},
			],
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

describe('the Release workflow tags only what the queue verified', () => {
	const steps = Object.values(release.jobs).flatMap((job) => job.steps ?? []);
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
		for (const job of Object.values(release.jobs)) {
			expect(job.if).toBeUndefined();
			expect(job['continue-on-error']).toBeUndefined();
		}
	});

	// The Version PR lands as a squash commit like any other, so its title is checked too.
	it('titles the Version PR as a Conventional Commit', () => {
		expect(isConventionalTitle(String(changesets?.with?.['pr-title']))).toBe(true);
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
