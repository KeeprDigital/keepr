import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/**
 * The Deploy workflow is only as good as its wiring: these read the committed
 * workflows. Nothing runs against GitHub; the procedure and the plan are tested
 * at their homes (`deploy{Procedure,Cli,Plan}.test.ts`).
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
	uses?: string;
	with?: Record<string, unknown>;
	strategy?: { matrix?: Record<string, unknown>; 'fail-fast'?: boolean };
	environment?: { name: string; url?: string } | string;
	concurrency?: { group: string; 'cancel-in-progress'?: boolean } | string;
	permissions?: Record<string, string>;
	outputs?: Record<string, string>;
	env?: Record<string, string>;
	steps?: Step[];
	'continue-on-error'?: unknown;
}
interface Workflow {
	on: Record<string, { inputs?: Record<string, { type?: string; options?: string[] }> } | null>;
	permissions?: Record<string, string>;
	concurrency?: unknown;
	jobs: Record<string, Job>;
}

function workflow(name: string): Workflow {
	return parse(readFileSync(`../../.github/workflows/${name}`, 'utf8')) as Workflow;
}

const deploy = workflow('deploy.yml');
const installation = workflow('deploy-installation.yml');
const INSTALLATION = './.github/workflows/deploy-installation.yml';
const CLI = 'packages/tooling/scripts/deploy/cli.mjs';
const PLAN = 'packages/tooling/scripts/deploy/plan.mjs';

const plan = deploy.jobs.plan!;
/** The jobs that deploy an Installation, by id. */
const deploying = Object.entries(deploy.jobs).filter(([, job]) => job.uses === INSTALLATION);
const deployJob = installation.jobs.deploy!;
const steps = deployJob.steps ?? [];
const index = (match: (step: Step) => boolean) => steps.findIndex(match);
const promote = index(
	(step) => step.run?.startsWith(`node .deploy-tooling/${CLI} deploy `) === true,
);

/** `${{ name }}` in `template`, each replaced by its value; an unknown name stays. */
function expand(template: unknown, values: Record<string, string>) {
	return String(template).replaceAll(
		/\$\{\{\s*([\w.-]+)\s*\}\}/g,
		(whole, name: string) => values[name] ?? whole,
	);
}

/** Every module `entry` imports, transitively, by its path from the repository's root. */
function importedModules(entry: string, seen = new Set<string>()): Set<string> {
	if (seen.has(entry)) return seen;
	seen.add(entry);
	const source = readFileSync(`../../${entry}`, 'utf8');
	for (const [, specifier] of source.matchAll(/^import [^;]*?from '(\.{1,2}\/[^']+)';$/gms))
		importedModules(new URL(specifier!, `file:///${entry}`).pathname.slice(1), seen);
	return seen;
}

function sparseCheckout(job: Job) {
	const checkout = (job.steps ?? []).find((step) => step.with?.path === '.deploy-tooling');
	return {
		checkout,
		patterns: String(checkout?.with?.['sparse-checkout'] ?? '')
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean),
	};
}

describe('a Deploy is dispatched by hand, for the apps it names', () => {
	it('has no trigger but a dispatch, and its Installation workflow none but a call', () => {
		expect(Object.keys(deploy.on)).toEqual(['workflow_dispatch']);
		expect(Object.keys(installation.on)).toEqual(['workflow_call']);
	});

	it('takes the Releases, the Environment, the recovery point, the parts mode and the override', () => {
		expect(Object.keys(deploy.on.workflow_dispatch?.inputs ?? {}).toSorted()).toEqual([
			'd1_recovery_point',
			'environment',
			'override',
			'releases',
			'validator',
		]);
	});

	// A refused plan leaves every deploying job without the outputs it runs on.
	it('plans nothing until the D1 recovery point is confirmed, then plans through the tested script', () => {
		const planSteps = plan.steps ?? [];
		const refuse = planSteps.findIndex(
			(step) => step.if === "inputs.d1_recovery_point != 'confirmed'",
		);
		const planning = planSteps.findIndex((step) => step.run === `node .deploy-tooling/${PLAN}`);

		expect(refuse).toBeGreaterThanOrEqual(0);
		expect(planSteps[refuse]!.run).toContain('exit 1');
		expect(planning).toBeGreaterThan(refuse);
		expect(planSteps[planning]!.env).toMatchObject({
			INPUT_RELEASES: '${{ inputs.releases }}',
			INPUT_OVERRIDE: '${{ inputs.override }}',
		});
		expect(plan.outputs).toEqual({
			accounts: `\${{ steps.${planSteps[planning]!.id}.outputs.accounts }}`,
			apps: `\${{ steps.${planSteps[planning]!.id}.outputs.apps }}`,
		});
	});
});

describe('Keepr Accounts deploys before the Apps, each app as its own job', () => {
	const [[accountsId, accounts], [appsId, apps]] = deploying as [[string, Job], [string, Job]];

	it('has two deploying jobs, for Keepr Accounts and for the Apps, each after the plan', () => {
		expect(deploying.map(([id]) => id)).toEqual([accountsId, appsId]);
		expect(accounts.needs).toBe('plan');
		expect(accounts.if).toBe("needs.plan.outputs.accounts != ''");
		expect(accounts.with).toMatchObject({
			app: 'accounts',
			release: '${{ needs.plan.outputs.accounts }}',
		});
		expect(apps.strategy?.matrix).toEqual({
			include: '${{ fromJSON(needs.plan.outputs.apps) }}',
		});
		expect(apps.with).toMatchObject({ app: '${{ matrix.app }}', release: '${{ matrix.release }}' });
	});

	// Skipped when the run names no Keepr Accounts; never run after it failed or was cancelled.
	it('runs the Apps after Keepr Accounts deployed, or when the run does not deploy it', () => {
		expect([apps.needs].flat().toSorted()).toEqual([accountsId, 'plan'].toSorted());
		expect(apps.if?.split('&&').map((clause) => clause.trim())).toEqual([
			'!cancelled()',
			"needs.plan.result == 'success'",
			"needs.plan.outputs.apps != '[]'",
			`(needs.${accountsId}.result == 'success' || needs.${accountsId}.result == 'skipped')`,
		]);
		// One App's failure does not cancel another's deploy part-way.
		expect(apps.strategy?.['fail-fast']).toBe(false);
	});

	it('passes every job the same Environment, parts mode and override', () => {
		for (const [, job] of deploying)
			expect(job.with).toMatchObject({
				environment: '${{ inputs.environment }}',
				parts: '${{ inputs.validator }}',
				override: '${{ inputs.override }}',
			});
	});
});

describe('each app × Environment deploys in its own GitHub environment, one run at a time', () => {
	it.each([
		['stream', 'production', 'stream-production', 'deploy-stream-production'],
		['accounts', 'production', 'accounts-production', 'deploy-accounts-production'],
	])('%s to %s', (app, environment, githubEnvironment, group) => {
		const values = { 'inputs.app': app, 'inputs.environment': environment };
		const target = deployJob.environment;
		const concurrency = deployJob.concurrency;

		expect(expand(typeof target === 'string' ? target : target?.name, values)).toBe(
			githubEnvironment,
		);
		expect(typeof concurrency === 'object' && expand(concurrency.group, values)).toBe(group);
		expect(typeof concurrency === 'object' && concurrency['cancel-in-progress']).toBe(false);
	});

	// Keyed by app × Environment: a run-wide group would hold one app behind another.
	it('has no group of its own, so two apps deploy at once', () => {
		expect(deploy.concurrency).toBeUndefined();
		for (const [, job] of Object.entries(deploy.jobs)) expect(job.concurrency).toBeUndefined();
	});
});

describe('an Installation deploys through the tooling, which advances its markers only behind every check', () => {
	it('checks out the Release with its full history, the tooling from its own commit, then installs the Release', () => {
		const release = index((step) => step.with?.ref === '${{ inputs.release }}');
		const tooling = index((step) => step.with?.path === '.deploy-tooling');
		const install = index((step) => step.run === 'pnpm install --frozen-lockfile');

		expect(release).toBeGreaterThanOrEqual(0);
		// Marker tags and deploy order need the commits a shallow clone lacks.
		expect(steps[release]!.with?.['fetch-depth']).toBe(0);
		expect([release, tooling, install, promote]).toEqual(
			[release, tooling, install, promote].toSorted((a, b) => a - b),
		);
		expect(steps[tooling]!.with).toMatchObject({
			ref: '${{ github.sha }}',
			'persist-credentials': false,
		});
		expect(steps.some((step) => step.run === 'echo /.deploy-tooling/ >> .git/info/exclude')).toBe(
			true,
		);
	});

	it('deploys the app it was called for, with the override only when one was given', () => {
		expect(steps[promote]!.run).toBe(
			`node .deploy-tooling/${CLI} deploy --app "$INPUT_APP" --env "$INPUT_ENVIRONMENT" --parts "$INPUT_PARTS" \${INPUT_OVERRIDE:+--override "$INPUT_OVERRIDE"}`,
		);
		expect(steps[promote]!.env).toMatchObject({
			INPUT_APP: '${{ inputs.app }}',
			INPUT_ENVIRONMENT: '${{ inputs.environment }}',
			INPUT_PARTS: '${{ inputs.parts }}',
			INPUT_OVERRIDE: '${{ inputs.override }}',
		});
	});

	it('cannot skip past a failed promotion, and deploys or moves a marker nowhere else', () => {
		expect(steps[promote]!.if).toBeUndefined();
		expect(steps[promote]!['continue-on-error']).toBeUndefined();
		for (const [position, step] of steps.entries())
			if (position !== promote)
				expect(step.run ?? '').not.toMatch(/git push|git tag|wrangler|pnpm (run )?deploy/);
	});

	// Job-level env reaches every step: the install's build scripts and the setup actions too.
	it('hands the Cloudflare credentials to the promotion step and to nothing else', () => {
		const holders = [
			...[...Object.values(deploy.jobs), deployJob].map((job) => job.env ?? {}),
			...[...(plan.steps ?? []), ...steps.filter((_, position) => position !== promote)].map(
				(step) => step.env ?? {},
			),
			...deploying.map(([, job]) => (job.with ?? {}) as Record<string, string>),
		];

		expect(steps[promote]!.env).toMatchObject({
			CLOUDFLARE_API_TOKEN: '${{ secrets.CLOUDFLARE_API_TOKEN }}',
			CLOUDFLARE_ACCOUNT_ID: '${{ secrets.CLOUDFLARE_ACCOUNT_ID }}',
		});
		expect(
			holders
				.flatMap((env) => Object.entries(env))
				.filter(
					([name, value]) =>
						/^CLOUDFLARE_|^WRANGLER_/.test(name) || String(value).includes('secrets.'),
				),
		).toEqual([]);
	});

	it('only the Installation job can write, and only the repository contents (its marker tags)', () => {
		expect(deploy.permissions).toEqual({ contents: 'read' });
		expect(plan.permissions).toBeUndefined();
		for (const [, job] of deploying) expect(job.permissions).toEqual({ contents: 'write' });
		expect(installation.permissions).toEqual({ contents: 'read' });
		expect(deployJob.permissions).toEqual({ contents: 'write' });
	});
});

describe('what a dispatch types reaches a shell only through env', () => {
	// An expression in `run:` is pasted into the script before the shell parses it.
	it.each([
		['deploy.yml', deploy],
		['deploy-installation.yml', installation],
	])('%s interpolates nothing into a run: script', (_, file) => {
		for (const [id, job] of Object.entries(file.jobs))
			for (const step of job.steps ?? []) expect(step.run ?? '', id).not.toContain('${{');
	});
});

// A module the sparse checkout leaves out fails on deploy day, not in review.
describe('a job that checks out only the tooling checks out every module it runs', () => {
	it.each([
		['plan', plan, PLAN],
		['deploy', deployJob, CLI],
	])('%s', (_, job, entry) => {
		const { checkout, patterns } = sparseCheckout(job);
		const modules = [...importedModules(entry)];

		expect(checkout?.with).toMatchObject({
			ref: '${{ github.sha }}',
			'persist-credentials': false,
		});
		expect(modules.length).toBeGreaterThan(2);
		for (const module of modules)
			expect(
				patterns.some((pattern) =>
					pattern.endsWith('/') ? module.startsWith(pattern) : module === pattern,
				),
				module,
			).toBe(true);
	});
});
