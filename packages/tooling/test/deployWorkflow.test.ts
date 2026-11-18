import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { configBindsKeeprAccounts } from '../scripts/ci-scope.mjs';
import { STAGING_THEN_PRODUCTION } from '../scripts/deploy/plan.mjs';
import { deployableApps } from '../scripts/deploy/release.mjs';
import { parseJsonc } from '../scripts/jsonc.mjs';

/**
 * The Deploy workflow is only as good as its wiring: these read the committed
 * workflows. Nothing runs against GitHub; the procedure, the plan, the
 * recovery point and the dispatch are tested at their homes
 * (`deploy{Procedure,Cli,Plan,Recovery,Dispatch}.test.ts`).
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
	secrets?: Record<string, string> | string;
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
	on: Record<
		string,
		{
			inputs?: Record<string, { type?: string; options?: string[]; default?: string }>;
			secrets?: Record<string, { required?: boolean }>;
		} | null
	>;
	permissions?: Record<string, string>;
	concurrency?: unknown;
	jobs: Record<string, Job>;
}

function workflow(name: string): Workflow {
	return parse(readFileSync(`../../.github/workflows/${name}`, 'utf8')) as Workflow;
}

const deploy = workflow('deploy.yml');
const installation = workflow('deploy-installation.yml');
const building = workflow('deploy-build.yml');
const release = workflow('release.yml');
const INSTALLATION = './.github/workflows/deploy-installation.yml';
const BUILD = './.github/workflows/deploy-build.yml';
const CLI = 'packages/tooling/scripts/deploy/cli.mjs';
const PLAN = 'packages/tooling/scripts/deploy/plan.mjs';
const DISPATCH = 'packages/tooling/scripts/deploy/dispatch.mjs';
/** Where the build job sets its output aside, and where each deploy places it from. */
const ARTIFACT_DIR = '$RUNNER_TEMP/build';

const plan = deploy.jobs.plan!;
/** The jobs that deploy an Installation, by id. */
const deploying = Object.entries(deploy.jobs).filter(([, job]) => job.uses === INSTALLATION);
const deployJob = installation.jobs.deploy!;
const buildJob = building.jobs.build!;
const steps = deployJob.steps ?? [];
const buildSteps = buildJob.steps ?? [];
const index = (match: (step: Step) => boolean) => steps.findIndex(match);
const promote = index(
	(step) => step.run?.startsWith(`node .deploy-tooling/${CLI} deploy `) === true,
);
const gates = index((step) => step.run?.startsWith(`node .deploy-tooling/${CLI} gates `) === true);
const download = index((step) => step.uses?.startsWith('actions/download-artifact@') === true);
const releaseCheckout = index((step) => step.with?.ref === '${{ inputs.release }}');
const mint = index((step) => step.uses?.startsWith('actions/create-github-app-token@') === true);
/** The Environment's Cloudflare credentials, and the release GitHub App's (ADR-0124). */
const CLOUDFLARE = ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'];
const RELEASE_APP = ['KEEPR_RELEASE_APP_ID', 'KEEPR_RELEASE_APP_PRIVATE_KEY'];
/** The staging operator Stream Keepr's acceptance gates sign in as (ADR-0129). */
const OPERATOR = [
	'STREAM_KEEPR_ACCEPTANCE_OPERATOR_EMAIL',
	'STREAM_KEEPR_ACCEPTANCE_OPERATOR_PASSWORD',
];
const ENVIRONMENTS = "contains(fromJSON(needs.plan.outputs.environments), '%s')";
const runs = (environment: string) => ENVIRONMENTS.replace('%s', environment);

/** `${{ name }}` in `template`, each replaced by its value; an unknown name stays. */
function expand(template: unknown, values: Record<string, string>) {
	return String(template).replaceAll(
		/\$\{\{\s*([\w.-]+)\s*\}\}/g,
		(whole, name: string) => values[name] ?? whole,
	);
}

/** An `if:` written over several lines, as its `&&` clauses. */
const clauses = (condition: string | undefined) =>
	(condition ?? '').split('&&').map((clause) => clause.trim());

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

describe('a Deploy is dispatched by a Release or by hand, for the apps it names', () => {
	it('has no trigger but a dispatch, and its build and Installation workflows none but a call', () => {
		expect(Object.keys(deploy.on)).toEqual(['workflow_dispatch']);
		expect(Object.keys(installation.on)).toEqual(['workflow_call']);
		expect(Object.keys(building.on)).toEqual(['workflow_call']);
	});

	// The approval replaced the typed recovery word (ADR-0125).
	it('takes the Releases, the Environments, the parts mode and the override', () => {
		expect(Object.keys(deploy.on.workflow_dispatch?.inputs ?? {}).toSorted()).toEqual([
			'environment',
			'override',
			'releases',
			'validator',
		]);
	});

	// An Environment an app's descriptor names, a Release's staging then
	// production, and nothing the dispatch could not deploy; by hand, production alone.
	it('offers every Environment some deploy descriptor names, and staging then production', () => {
		const environments = deployableApps('../..').flatMap((app) =>
			Object.keys(
				(
					parseJsonc(readFileSync(`../../apps/${app}/deploy.jsonc`, 'utf8')) as {
						environments: Record<string, unknown>;
					}
				).environments,
			),
		);
		const input = deploy.on.workflow_dispatch?.inputs?.environment;

		expect(input?.options?.toSorted()).toEqual(
			[...new Set(environments), STAGING_THEN_PRODUCTION].toSorted(),
		);
		expect(input?.default).toBe('production');
	});

	it('plans through the tested script, from what was dispatched', () => {
		const planSteps = plan.steps ?? [];
		const planning = planSteps.findIndex((step) => step.run === `node .deploy-tooling/${PLAN}`);

		expect(planning).toBeGreaterThanOrEqual(0);
		expect(planSteps[planning]!.env).toMatchObject({
			INPUT_RELEASES: '${{ inputs.releases }}',
			INPUT_ENVIRONMENT: '${{ inputs.environment }}',
			INPUT_OVERRIDE: '${{ inputs.override }}',
		});
		expect(plan.outputs).toEqual(
			Object.fromEntries(
				['accounts', 'apps', 'builds', 'environments'].map((output) => [
					output,
					`\${{ steps.${planSteps[planning]!.id}.outputs.${output} }}`,
				]),
			),
		);
	});
});

describe('each app builds once, and every Environment deploys that build', () => {
	const build = deploy.jobs.build!;
	const buildStep = buildSteps.findIndex(
		(step) => step.run?.startsWith(`node .deploy-tooling/${CLI} build `) === true,
	);
	const upload = buildSteps.findIndex(
		(step) => step.uses?.startsWith('actions/upload-artifact@') === true,
	);

	it('builds every app the plan names, Keepr Accounts too, before any deploy', () => {
		expect(build.needs).toBe('plan');
		expect(build.uses).toBe(BUILD);
		expect(build.strategy?.matrix).toEqual({
			include: '${{ fromJSON(needs.plan.outputs.builds) }}',
		});
		expect(build.with).toEqual({ app: '${{ matrix.app }}', release: '${{ matrix.release }}' });
		for (const [id, job] of deploying) expect([job.needs].flat(), id).toContain('build');
	});

	it('builds the Release with the tooling, then uploads what it built, once', () => {
		expect(buildSteps[buildStep]!.run).toBe(
			`node .deploy-tooling/${CLI} build --app "$INPUT_APP" --artifact "${ARTIFACT_DIR}"`,
		);
		expect(upload).toBeGreaterThan(buildStep);
		expect(buildSteps[upload]!.with).toMatchObject({
			name: 'build-${{ inputs.app }}',
			path: '${{ runner.temp }}/build',
			'if-no-files-found': 'error',
		});
		expect(
			buildSteps.filter((step) => step.uses?.startsWith('actions/upload-artifact@')),
		).toHaveLength(1);
		expect(steps.some((step) => step.uses?.startsWith('actions/upload-artifact@'))).toBe(false);
	});

	it('downloads that artifact into each deploy, which places it rather than building', () => {
		expect(download).toBeGreaterThanOrEqual(0);
		expect(download).toBeLessThan(promote);
		expect(steps[download]!.with).toEqual({
			name: 'build-${{ inputs.app }}',
			path: '${{ runner.temp }}/build',
		});
		expect(steps[promote]!.run).toContain(`--artifact "${ARTIFACT_DIR}"`);
	});

	it('builds with no secret and no GitHub environment', () => {
		expect(build.secrets).toBeUndefined();
		expect(building.on.workflow_call?.secrets).toBeUndefined();
		expect(buildJob.environment).toBeUndefined();
		expect(JSON.stringify(building)).not.toContain('secrets.');
	});
});

describe('Keepr Accounts reaches each Environment before the Apps, and production comes after staging', () => {
	const job = (id: string) => deploy.jobs[id]!;

	it.each([
		['accounts-staging', 'staging', 'accounts'],
		['apps-staging', 'staging', '${{ matrix.app }}'],
		['accounts-production', 'production', 'accounts'],
		['apps-production', 'production', '${{ matrix.app }}'],
	])('%s deploys to %s', (id, environment, app) => {
		expect(job(id).uses).toBe(INSTALLATION);
		expect(job(id).with).toMatchObject({ app, environment });
	});

	it('has those four deploying jobs and no other', () => {
		expect(deploying.map(([id]) => id)).toEqual([
			'accounts-staging',
			'apps-staging',
			'accounts-production',
			'apps-production',
		]);
	});

	// Each `if` names every way its job may run, and nothing after a failure or a cancel.
	it.each([
		['accounts-staging', ['build', 'plan'], ["needs.plan.outputs.accounts != ''", runs('staging')]],
		[
			'apps-staging',
			['accounts-staging', 'build', 'plan'],
			[
				'!cancelled()',
				"needs.build.result == 'success'",
				"needs.plan.outputs.apps != '[]'",
				runs('staging'),
				"(needs.plan.outputs.accounts == '' || needs.accounts-staging.result == 'success')",
			],
		],
		[
			'accounts-production',
			['accounts-staging', 'build', 'plan'],
			[
				'!cancelled()',
				"needs.build.result == 'success'",
				"needs.plan.outputs.accounts != ''",
				runs('production'),
				`(!${runs('staging')} || needs.accounts-staging.result == 'success')`,
			],
		],
		[
			'apps-production',
			['accounts-production', 'apps-staging', 'build', 'plan'],
			[
				'!cancelled()',
				"needs.build.result == 'success'",
				"needs.plan.outputs.apps != '[]'",
				runs('production'),
				`(!${runs('staging')} || needs.apps-staging.result == 'success')`,
				"(needs.plan.outputs.accounts == '' || needs.accounts-production.result == 'success')",
			],
		],
	])('%s runs after %j, only when %j', (id, needs, condition) => {
		expect([job(id).needs].flat().toSorted()).toEqual(needs);
		expect(clauses(job(id).if)).toEqual(condition);
	});

	// One App's failure does not cancel another's deploy part-way.
	it.each(['apps-staging', 'apps-production'])('%s deploys each App as its own job', (id) => {
		expect(job(id).strategy?.matrix).toEqual({
			include: '${{ fromJSON(needs.plan.outputs.apps) }}',
		});
		expect(job(id).with).toMatchObject({ release: '${{ matrix.release }}' });
		expect(job(id).strategy?.['fail-fast']).toBe(false);
	});

	it('passes every job the same parts mode and override', () => {
		for (const [, job] of deploying)
			expect(job.with).toMatchObject({
				parts: '${{ inputs.validator }}',
				override: '${{ inputs.override }}',
			});
	});
});

// The GitHub environment is the Environment's, shared by every app (ADR-0122);
// `production`'s required reviewer is the approval. The concurrency group is
// the Installation's.
describe("each Installation deploys in its Environment's GitHub environment, one run at a time", () => {
	it.each([
		['stream', 'staging', 'staging', 'deploy-stream-staging'],
		['stream', 'production', 'production', 'deploy-stream-production'],
		['accounts', 'production', 'production', 'deploy-accounts-production'],
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
		const tooling = index((step) => step.with?.path === '.deploy-tooling');
		const install = index((step) => step.run === 'pnpm install --frozen-lockfile');

		expect(releaseCheckout).toBeGreaterThanOrEqual(0);
		// Marker tags and deploy order need the commits a shallow clone lacks.
		expect(steps[releaseCheckout]!.with?.['fetch-depth']).toBe(0);
		expect([releaseCheckout, tooling, install, promote]).toEqual(
			[releaseCheckout, tooling, install, promote].toSorted((a, b) => a - b),
		);
		expect(steps[tooling]!.with).toMatchObject({
			ref: '${{ github.sha }}',
			'persist-credentials': false,
		});
		expect(steps.some((step) => step.run === 'echo /.deploy-tooling/ >> .git/info/exclude')).toBe(
			true,
		);
	});

	// The D1 recovery point is the tooling's, before its first remote change
	// (deployCli.test.ts); nothing here reaches Cloudflare before the deploy.
	it('deploys the app it was called for, with the override only when one was given', () => {
		expect(steps[promote]!.run).toBe(
			`node .deploy-tooling/${CLI} deploy --app "$INPUT_APP" --env "$INPUT_ENVIRONMENT" --artifact "${ARTIFACT_DIR}" --parts "$INPUT_PARTS" \${INPUT_OVERRIDE:+--override "$INPUT_OVERRIDE"}`,
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
		for (const [position, step] of [...steps.entries(), ...buildSteps.entries()])
			if (step !== steps[promote])
				expect(step.run ?? '', String(position)).not.toMatch(
					/git push|git tag|wrangler|pnpm (run )?deploy|cli\.mjs deploy/,
				);
	});

	// Only after the deploy verified, and only in staging: a failure fails the
	// staging job, so production does not deploy. The gates write, so production
	// never runs them (ADR-0129).
	it('runs the acceptance gates in staging alone, after the deploy, against staging', () => {
		expect(gates).toBeGreaterThan(promote);
		expect(steps[gates]!.if).toBe("inputs.environment == 'staging'");
		expect(steps[gates]!.run).toBe(
			`node .deploy-tooling/${CLI} gates --app "$INPUT_APP" --env "$INPUT_ENVIRONMENT"`,
		);
		expect(steps[gates]!.env).toMatchObject({
			STREAM_KEEPR_ACCEPTANCE_ENVIRONMENT: '${{ inputs.environment }}',
		});
		expect(steps[gates]!['continue-on-error']).toBeUndefined();
	});

	// Job-level env reaches every step: the install's build scripts and the setup actions too.
	// The validator gate writes with Wrangler, so the gates hold the Cloudflare credentials too.
	it.each([
		[
			'the Cloudflare credentials',
			'the promotion and gates steps',
			[promote, gates],
			CLOUDFLARE,
			/^CLOUDFLARE_|^WRANGLER_/,
		],
		["the release GitHub App's key", 'the token step', [mint], RELEASE_APP, /^KEEPR_RELEASE_APP_/],
		[
			'the staging operator',
			'the gates step',
			[gates],
			OPERATOR,
			/^STREAM_KEEPR_ACCEPTANCE_OPERATOR_/,
		],
	])('hands %s to %s and to nothing else', (_, _step, holders, secrets, names) => {
		const elsewhere = [
			...[...Object.values(deploy.jobs), deployJob, buildJob].map((job) => job.env ?? {}),
			...[
				...(plan.steps ?? []),
				...buildSteps,
				...steps.filter((_, position) => !holders.includes(position)),
			].flatMap((step) => [step.env ?? {}, step.with ?? {}]),
			...Object.values(deploy.jobs).map((job) => (job.with ?? {}) as Record<string, string>),
		].flatMap((values) => Object.entries(values));

		for (const holder of holders) {
			const held = Object.values({ ...steps[holder]?.env, ...steps[holder]?.with });
			for (const name of secrets) expect(held).toContain(`\${{ secrets.${name} }}`);
		}
		expect(
			elsewhere.filter(
				([name, value]) =>
					names.test(name) || secrets.some((secret) => String(value).includes(`secrets.${secret}`)),
			),
		).toEqual([]);
	});

	// A called workflow sees an environment secret only when its caller passes it
	// by name; `secrets: inherit` would hand it every other secret too.
	it('each deploying call passes the Cloudflare credentials and the App key by name, which the Installation requires', () => {
		const passed = [...CLOUDFLARE, ...RELEASE_APP];
		const byName = (names: string[]) =>
			Object.fromEntries(names.map((name) => [name, `\${{ secrets.${name} }}`]));

		for (const [id, job] of deploying)
			expect(job.secrets, id).toEqual(
				byName(id === 'apps-staging' ? [...passed, ...OPERATOR] : passed),
			);
		expect(installation.on.workflow_call?.secrets).toEqual({
			...Object.fromEntries(passed.map((name) => [name, { required: true }])),
			...Object.fromEntries(OPERATOR.map((name) => [name, { required: false }])),
		});
	});

	// GITHUB_TOKEN can never hold `workflows`, so it cannot push a marker onto a
	// Release whose workflows differ from main's (ADR-0124).
	it("pushes the markers with the release GitHub App's token, narrowed to contents and workflows", () => {
		expect(mint).toBeGreaterThanOrEqual(0);
		expect(mint).toBeLessThan(releaseCheckout);
		expect(steps[mint]!.with).toEqual({
			'client-id': '${{ secrets.KEEPR_RELEASE_APP_ID }}',
			'private-key': '${{ secrets.KEEPR_RELEASE_APP_PRIVATE_KEY }}',
			'permission-contents': 'write',
			'permission-workflows': 'write',
		});
		expect(steps[releaseCheckout]!.with).toMatchObject({
			token: `\${{ steps.${steps[mint]!.id}.outputs.token }}`,
			'persist-credentials': true,
		});
	});

	// Every write goes through the App's token.
	it('gives GITHUB_TOKEN no more than read access to the repository contents', () => {
		for (const file of [deploy, installation, building])
			expect(file.permissions).toEqual({ contents: 'read' });
		for (const job of [...Object.values(deploy.jobs), deployJob, buildJob])
			expect(job.permissions ?? deploy.permissions).toEqual({ contents: 'read' });
	});
});

describe('what a dispatch types reaches a shell only through env', () => {
	// An expression in `run:` is pasted into the script before the shell parses it.
	it.each([
		['deploy.yml', deploy],
		['deploy-installation.yml', installation],
		['deploy-build.yml', building],
		['release.yml', release],
	])('%s interpolates nothing into a run: script', (_, file) => {
		for (const [id, job] of Object.entries(file.jobs))
			for (const step of job.steps ?? []) expect(step.run ?? '', id).not.toContain('${{');
	});
});

// A module the sparse checkout leaves out fails on deploy day, not in review.
describe('a job that checks out only the tooling checks out every module it runs', () => {
	it.each([
		['plan', plan, PLAN],
		['build', buildJob, CLI],
		['deploy', deployJob, CLI],
		['dispatch', release.jobs.deploy!, DISPATCH],
	])('%s', (_, job, entry) => {
		const { checkout, patterns } = sparseCheckout(job);
		const modules = [...importedModules(entry)];

		expect(checkout?.with).toMatchObject({ 'persist-credentials': false });
		expect(checkout?.with?.ref ?? '${{ github.sha }}').toBe('${{ github.sha }}');
		expect(modules.length).toBeGreaterThan(2);
		for (const module of modules)
			expect(
				patterns.some((pattern) =>
					pattern.endsWith('/') ? module.startsWith(pattern) : module === pattern,
				),
				module,
			).toBe(true);
		expect(
			(job.steps ?? []).some((step) => step.run?.startsWith(`node .deploy-tooling/${entry}`)),
		).toBe(true);
	});
});

// The deploy's build runs the app's `worker:smoke` with no Accounts Stand-in,
// which CI's Worker leg starts around `keepr-deploy check` instead. The first
// App to bind Keepr Accounts moves that wrapping into the tooling's build step.
it('no deployable app binds Keepr Accounts while the deploy builds without the stand-in', () => {
	const apps = deployableApps('../..');
	const config = (app: string) =>
		parseJsonc(readFileSync(`../../apps/${app}/wrangler.jsonc`, 'utf8'));

	expect(apps).toContain('stream');
	expect(apps.filter((app) => configBindsKeeprAccounts(config(app)))).toEqual([]);
});
