import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { parseJsonc } from '@keepr/tooling/scripts/jsonc.mjs';
import { RUN_SLOT_COSTS } from '@keepr/tooling/scripts/slots.mjs';
import { GATES, selectGates } from '../../../scripts/verify.mjs';

/**
 * The gates and the deploy are only as good as their wiring: these read the
 * committed package.json, verify graph and CI workflow. Nothing runs remotely.
 */

interface Step {
	run?: string;
}
interface Workflow {
	jobs: Record<string, { steps?: Step[] }>;
}

function scriptsOf(manifest: string) {
	return (JSON.parse(readFileSync(manifest, 'utf8')) as { scripts: Record<string, string> })
		.scripts;
}

const scripts = scriptsOf('package.json');
/** The workspace's own: the lint is one run over every app and package. */
const workspaceScripts = scriptsOf('../../package.json');
/** Score Keepr's and Keepr Accounts' heavy gates draw on the same machine's slots. */
const scoreScripts = scriptsOf('../score/package.json');
const accountsScripts = scriptsOf('../accounts/package.json');

function workflow(name: string): Workflow {
	return parse(readFileSync(`../../.github/workflows/${name}`, 'utf8')) as Workflow;
}

function steps(file: Workflow, job?: string): Step[] {
	return (job === undefined ? Object.values(file.jobs) : [file.jobs[job]!]).flatMap(
		(entry) => entry.steps ?? [],
	);
}

const ci = workflow('ci.yml');
const ciCommands = steps(ci)
	.flatMap((step) => (step.run ?? '').split('\n'))
	.map((line) => line.trim())
	.filter((line) => line.startsWith('pnpm '));

/** What deploys, and what CI's Worker leg checks, through `keepr-deploy check` (ADR-0119). */
const descriptor = parseJsonc(readFileSync('deploy.jsonc', 'utf8')) as {
	build: string[];
	parts: Record<string, { config: string }>;
};

describe('verify and CI run the same gates', () => {
	it("builds once, then runs the Worker dry run and smoke, in verify and in the descriptor's build, which CI and the deploy run", () => {
		expect(scripts['worker:smoke']).not.toContain('build');
		expect(Object.values(GATES).filter((gate) => gate.command.includes('build'))).toHaveLength(1);
		expect(descriptor.build).toEqual(['build', 'worker:dry-run', 'worker:smoke']);
	});

	it('typechecks and bundles the silent-video validator Worker, in verify and CI', () => {
		expect(scripts.typecheck).toMatch(/&& pnpm typecheck:validator(?: |$)/u);
		expect(Object.keys(selectGates(['--quick']))).toContain('typecheck:validator');
		expect(Object.keys(selectGates([]))).toContain('validator:dry-run');
		expect(ciCommands).toContain('pnpm typecheck');
		// CI bundles each part of the descriptor, as `validator:dry-run` does.
		expect(scripts['validator:dry-run']).toContain(
			`--config ${descriptor.parts.validator?.config}`,
		);
	});

	it('runs every gate `pnpm test` runs as a CI step', () => {
		// CI splits the gates across parallel jobs rather than calling `pnpm test`.
		const commands = Object.entries(selectGates(['--tests']))
			.filter(([name]) => name !== 'prepare')
			.map(([, gate]) => `pnpm ${gate.command.slice(1).join(' ')}`);

		expect(commands).toEqual(
			expect.arrayContaining(['pnpm test:unit:coverage', 'pnpm test:integration --run']),
		);
		expect(
			commands.filter(
				(command) => !ciCommands.some((step) => step === command || step.startsWith(`${command} `)),
			),
		).toEqual([]);
	});
});

// Before a push, a change is checked in proportion to it; CI is the full gate (README § Testing).
describe('verify --quick checks what a checkout changes', () => {
	const firstStage = [
		'prepare',
		'lint',
		'typecheck:app',
		'typecheck:test',
		'typecheck:validator',
		'test:unit:coverage',
		'test:nuxt:coverage',
	];

	it('checks its changesets, lints, typechecks, and runs the unit and Nuxt tests the change reaches', () => {
		const gates = selectGates(['--quick'], () => 'origin/main');

		expect(Object.keys(gates)).toEqual([
			'changesets',
			'prepare',
			'lint',
			'typecheck:app',
			'typecheck:test',
			'typecheck:validator',
			'test:unit:changed',
			'test:nuxt:changed',
		]);
		expect(gates.changesets!.command.join(' ')).toBe('exec keepr-changeset-check');
		expect(gates['test:unit:changed']!.command.join(' ')).toBe(
			'exec vitest run --changed origin/main --passWithNoTests',
		);
		expect(gates['test:nuxt:changed']!.command.join(' ')).toBe(
			'exec vitest run --config vitest.nuxt.config.ts --changed origin/main --passWithNoTests',
		);
	});

	it.each([
		{
			run: 'asked for all of it',
			argv: ['--quick', '--all'],
			baseRef: 'origin/main',
		},
		{
			run: 'there is no main to measure the change from',
			argv: ['--quick'],
			baseRef: undefined,
		},
	])('runs the whole first stage when $run', ({ argv, baseRef }) => {
		expect(Object.keys(selectGates(argv, () => baseRef))).toEqual(firstStage);
	});
});

// A gate outside the pool is one every other worktree's runs cannot see (`@keepr/tooling`).
describe('every heavy gate takes run slots', () => {
	it.each([
		{ script: 'lint', cost: 'lint', from: workspaceScripts },
		{ script: 'typecheck:app', cost: 'typecheck', from: scripts },
		{ script: 'typecheck:test', cost: 'typecheck', from: scripts },
		{ script: 'build', cost: 'build', from: scripts },
		{ script: 'worker:smoke', cost: 'worker-smoke', from: scripts },
		{ script: 'build', cost: 'build', from: scoreScripts },
		{ script: 'typecheck', cost: 'typecheck', from: scoreScripts },
		{ script: 'build', cost: 'build', from: accountsScripts },
		{ script: 'typecheck', cost: 'typecheck', from: accountsScripts },
	] as const)('pnpm $script runs inside the slots a $cost costs', ({ script, cost, from }) => {
		expect(RUN_SLOT_COSTS).toHaveProperty(cost);
		expect(from[script]).toContain(`keepr-slots ${cost} -- `);
	});

	it("the app's lint is the workspace's, so it takes those slots too", () => {
		expect(scripts.lint).toBe('pnpm --workspace-root lint');
	});
});

// Each starts servers, and two at once make every result meaningless (README § Testing).
describe('verify runs the server-backed suites one at a time', () => {
	it('chains integration, local-auth and the browser gates, each behind the one before', () => {
		const serverBacked = Object.keys(GATES).filter((name) =>
			/^test:(?:integration|local-auth)$|^accept:/u.test(name),
		);

		expect(serverBacked.length).toBeGreaterThan(2);
		expect(GATES['test:integration']!.after).toEqual(
			expect.arrayContaining(['test:unit:coverage', 'test:nuxt:coverage']),
		);
		expect(serverBacked.slice(1).map((name) => GATES[name as keyof typeof GATES].after)).toEqual(
			serverBacked.slice(0, -1).map((previous) => [previous]),
		);
	});
});

describe('the deploy runs the tooling, which advances the promotion markers only behind every check', () => {
	// The procedure, its order and the Deploy workflow are tested at their home, `@keepr/tooling`.
	it("is Stream Keepr's descriptor deployed by keepr-deploy, from every deploy script", () => {
		expect(
			Object.fromEntries(Object.entries(scripts).filter(([name]) => /^deploy(?::|$)/.test(name))),
		).toEqual({
			deploy: 'keepr-deploy deploy --app stream --env production',
			'deploy:verify': 'keepr-deploy verify --app stream --env production',
			'deploy:mark-app': 'keepr-deploy mark-app --app stream --env production',
			'deploy:status': 'keepr-deploy status --app stream --env production',
			'deploy:validator': 'keepr-deploy part validator --app stream --env production',
		});
		expect(workspaceScripts.deploy).toBe('keepr-deploy deploy');
	});
});
