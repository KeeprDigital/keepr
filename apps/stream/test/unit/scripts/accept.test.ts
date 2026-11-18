import { access, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parseJsonc } from '@keepr/tooling/scripts/jsonc.mjs';
import { DEPLOY_DAY, HARNESSES, main } from '../../../scripts/accept.mjs';
import { PAGES, main as runBrowserPage } from '../../../scripts/run-browser-page-acceptance.mjs';
import { GATES } from '../../../scripts/verify.mjs';

const repositoryRoot = join(import.meta.dirname, '../../..');

/**
 * `scripts/accept.mjs` is the one list of acceptance harnesses; package.json,
 * verify, CI, and README § Deploy day all name harnesses through it.
 */
describe('pnpm accept', () => {
	it('points every harness at a runner that exists', async () => {
		for (const {
			script: [file],
		} of Object.values(HARNESSES))
			await expect(access(join(repositoryRoot, 'scripts', file!))).resolves.toBeUndefined();
	});

	it('lists every run-* runner, so none is reachable only by path', async () => {
		const runners = (await readdir(join(repositoryRoot, 'scripts'))).filter((file) =>
			/^run-.+\.mjs$/u.test(file),
		);
		const listed = new Set(Object.values(HARNESSES).map(({ script: [file] }) => file));

		expect(runners.filter((file) => !listed.has(file))).toEqual([]);
	});

	it('runs only harnesses with a deployed mode on deploy day', () => {
		expect(DEPLOY_DAY.length).toBeGreaterThan(0);
		expect(
			DEPLOY_DAY.filter((name) => !(name in HARNESSES) || HARNESSES[name]?.deployed === false),
		).toEqual([]);
	});

	it('names only known harnesses in verify gates', () => {
		const accepted = Object.values(GATES)
			.filter((gate) => gate.command[1] === 'accept')
			.map((gate) => gate.command[2]!);

		expect(accepted.length).toBeGreaterThan(0);
		expect(accepted.filter((name) => !(name in HARNESSES))).toEqual([]);
	});

	it('routes browser-page harnesses to pages the runner knows', () => {
		const pages = Object.values(HARNESSES)
			.filter(({ script: [file] }) => file === 'run-browser-page-acceptance.mjs')
			.map(({ script: [, page] }) => page!);

		expect(pages.sort()).toEqual(Object.keys(PAGES).sort());
	});

	it('refuses an unknown browser page rather than running nothing', async () => {
		await expect(
			runBrowserPage(['node', 'run-browser-page-acceptance.mjs', 'nope']),
		).rejects.toThrow(/expected one of/u);
	});

	it('leaves no package script calling a runner directly', async () => {
		const packageJson = JSON.parse(
			await readFile(join(repositoryRoot, 'package.json'), 'utf8'),
		) as {
			scripts: Record<string, string>;
		};

		expect(
			Object.values(packageJson.scripts).filter((command) => /scripts\/run-/u.test(command)),
		).toEqual([]);
	});

	// The Deploy workflow's staging job runs the descriptor's gates (ADR-0129).
	it('gives the staging job every deploy-day gate, through the deploy descriptor', async () => {
		const [descriptor, packageJson] = await Promise.all(
			['deploy.jsonc', 'package.json'].map(async (file) =>
				parseJsonc(await readFile(join(repositoryRoot, file), 'utf8')),
			),
		);

		expect(descriptor.gates.map((gate: string) => packageJson.scripts[gate])).toEqual([
			'node scripts/accept.mjs deployed',
		]);
	});

	it('refuses an unknown harness and a deployed run of a local-only one', async () => {
		const exitCode = process.exitCode;
		vi.spyOn(process.stdout, 'write').mockReturnValue(true);
		vi.spyOn(process.stderr, 'write').mockReturnValue(true);
		try {
			await main(['node', 'accept.mjs', 'nope']);
			expect(process.exitCode).toBe(2);
			process.exitCode = undefined;
			await main(['node', 'accept.mjs', 'animation-effects', '--deployed']);
			expect(process.exitCode).toBe(2);
		} finally {
			process.exitCode = exitCode;
			vi.restoreAllMocks();
		}
	});

	describe('deploy day', () => {
		const complete = {
			STREAM_KEEPR_BROWSER_ACCEPTANCE_URL: 'https://stream.keepr.digital',
			STREAM_KEEPR_ACCEPTANCE_OPERATOR_EMAIL: 'ops@keepr.digital',
			STREAM_KEEPR_ACCEPTANCE_OPERATOR_PASSWORD: 'their-password',
			CLOUDFLARE_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
		};

		async function deployDay(
			env: Record<string, string | undefined>,
			exitOf: (name: string) => number = () => 0,
		) {
			const exitCode = process.exitCode;
			const runHarness = vi.fn(async (name: string) => exitOf(name));
			const written: string[] = [];
			const printed: string[] = [];
			vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
				printed.push(String(chunk));
				return true;
			});
			vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
				written.push(String(chunk));
				return true;
			});
			try {
				await main(['node', 'accept.mjs', 'deployed'], { env, runHarness });
				return {
					exitCode: process.exitCode,
					runHarness,
					stderr: written.join(''),
					stdout: printed.join(''),
				};
			} finally {
				process.exitCode = exitCode;
				vi.restoreAllMocks();
			}
		}

		it('runs no gate when the target is incomplete, so the first cannot write before a later one refuses', async () => {
			// #619: the validator gate used to stage fixtures in production and only
			// then would graphics-delivery stop for want of an operator.
			for (const missing of Object.keys(complete)) {
				const { exitCode, runHarness, stderr } = await deployDay({
					...complete,
					[missing]: undefined,
				});

				expect(runHarness).not.toHaveBeenCalled();
				expect(exitCode).toBe(1);
				expect(stderr).toMatch(
					/^accept-deployed (?:harness-precondition-unmet|harness-operator-unavailable) /mu,
				);
			}
		});

		it('runs no gate against an alternate URL the committed configs do not serve', async () => {
			const { runHarness, stderr } = await deployDay({
				...complete,
				STREAM_KEEPR_BROWSER_ACCEPTANCE_URL: 'https://staging.keepr.digital',
			});

			expect(runHarness).not.toHaveBeenCalled();
			expect(stderr).toContain(
				'accept-deployed harness-target-inconsistent reason=origin-not-installation',
			);
		});

		it('checks the target against the Environment it is told, before any gate', async () => {
			const { runHarness, stderr } = await deployDay({
				...complete,
				STREAM_KEEPR_ACCEPTANCE_ENVIRONMENT: 'staging',
			});

			expect(runHarness).not.toHaveBeenCalled();
			expect(stderr).toMatch(/^accept-deployed harness-target-inconsistent reason=/mu);
		});

		it('runs no gate against production in CI, where no person started it', async () => {
			const { exitCode, runHarness, stderr } = await deployDay({ ...complete, CI: 'true' });

			expect(runHarness).not.toHaveBeenCalled();
			expect(exitCode).toBe(1);
			expect(stderr).toContain(
				'accept-deployed harness-precondition-unmet reason=production-unattended',
			);
		});

		it('cannot start a real runner from an imported main, even for a complete target', async () => {
			// The regression #619's development hit: an imported `main` with no
			// injected runner spawned the real deployed gates on the shell's login.
			vi.spyOn(process.stdout, 'write').mockReturnValue(true);
			vi.spyOn(process.stderr, 'write').mockReturnValue(true);
			try {
				await expect(main(['node', 'accept.mjs', 'deployed'], { env: complete })).rejects.toThrow(
					/without a runHarness/u,
				);
				await expect(
					main(['node', 'accept.mjs', 'silent-video-validator', '--deployed']),
				).rejects.toThrow(/without a runHarness/u);
			} finally {
				vi.restoreAllMocks();
			}
		});

		it('refuses an incomplete target before reaching any runner, injected or not', async () => {
			const exitCode = process.exitCode;
			vi.spyOn(process.stdout, 'write').mockReturnValue(true);
			vi.spyOn(process.stderr, 'write').mockReturnValue(true);
			try {
				await main(['node', 'accept.mjs', 'deployed'], { env: {} });
				expect(process.exitCode).toBe(1);
			} finally {
				process.exitCode = exitCode;
				vi.restoreAllMocks();
			}
		});

		it('runs every gate in order once the target is complete', async () => {
			const { exitCode, runHarness, stdout } = await deployDay(complete);

			expect(exitCode).toBeUndefined();
			expect(stdout).toContain('against the production Environment');
			expect(runHarness.mock.calls).toEqual(DEPLOY_DAY.map((name) => [name, ['--deployed']]));
		});

		// The staging job's summary says which gates ran, beside the production approval.
		it('says in the step summary which gates passed, which failed and which did not run', async () => {
			const directory = await mkdtemp(join(tmpdir(), 'accept-summary-'));
			const summary = join(directory, 'summary.md');
			try {
				await deployDay({ ...complete, GITHUB_STEP_SUMMARY: summary }, (name) =>
					name === 'still-images' ? 1 : 0,
				);

				expect(await readFile(summary, 'utf8')).toBe(
					[
						'Deployed acceptance gates against the production Environment:',
						'',
						'- silent-video-validator: passed',
						'- graphics-delivery: passed',
						'- still-images: failed',
						'- silent-video: not run',
						'- fonts: not run',
						'- graphics-package: not run',
						'',
					].join('\n'),
				);
			} finally {
				await rm(directory, { recursive: true, force: true });
			}
		});
	});
});
