#!/usr/bin/env node
/**
 * keepr-deploy: the deploy procedure for any app and Environment (ADR-0119).
 *
 * It runs at the root of the Release checkout being deployed, or anywhere in
 * it, and reads the app's deploy descriptor from that checkout. The Deploy
 * workflow runs it from its own commit (`.deploy-tooling`), never from the
 * Release; locally it is `pnpm run deploy --app <app> --env <env>`, with
 * `wrangler login`, and an app's `deploy:*` scripts are thin calls to it.
 *
 * The Wrangler configs name each Environment's account; `deploy` and `part`
 * refuse an exported `CLOUDFLARE_ACCOUNT_ID` they contradict (`account.mjs`).
 *
 * Commands:
 *
 * - `deploy`: build once (or place `--artifact`), refusing a build that
 *   records another commit or a test-only flag (`provenance.mjs`), then for
 *   the Environment: parts by fingerprint (`--parts auto|always|never`),
 *   deploy order between Keepr Accounts and its Apps (`order.mjs`;
 *   `--override <reason>` bypasses it, and the app's marker records the
 *   reason), each D1 database's Time Travel bookmark (`recovery.mjs`; refused
 *   without one before the first remote change, read again immediately before
 *   the migration and recorded in the app's marker), mark pending, migrate D1,
 *   deploy, verify the Environment's URL, mark deployed (`procedure.mjs`). To
 *   production, a checkout that is dirty or whose `HEAD` is not the app's
 *   Release tag is refused unless `--unreleased <reason>` says why; the
 *   marker records it.
 * - `build [--artifact <dir>]`: the descriptor's build scripts only, into its
 *   output directory, which then records the commit it was built from
 *   (`provenance.mjs`), copied to `--artifact` for a build job to upload: the
 *   one build every Environment deploys (`deploy --artifact`).
 * - `check`: what CI checks of each deployable app's Worker: each part bundled
 *   as a deploy would upload it (no Docker, no credentials), then `build`.
 *   With `--env`, instead, what a deploy to that Environment would refuse its
 *   Installation for, building nothing: each Worker's required secrets
 *   (`secrets.mjs`), read from Cloudflare. The app's is read through its built
 *   configuration, so it needs a build of this checkout (or a placed
 *   artifact of it) first.
 * - `verify`: check the Installation serves this checkout's Release, at the
 *   Environment's URL or at `KEEPR_DEPLOY_URL`, which only this command reads.
 * - `gates`: the descriptor's acceptance gates, each against the
 *   Environment's Installation (`KEEPR_DEPLOY_URL`), stopping at the first
 *   that fails: the staging job's, after its deploy, with no person present
 *   (ADR-0125, ADR-0129).
 * - `part <name>`: deploy one part between its markers, whatever its fingerprint.
 * - `mark-app <pending|deployed>`: write the app's marker by hand, recording
 *   whether its built Worker needs Keepr Accounts, as a deploy would, from a
 *   build of this checkout.
 * - `status`: every marker of the app in the Environment, and what a deploy of
 *   this checkout would do with each part; refused beside a build of another
 *   commit.
 */

import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { refuseAccountMismatch } from './account.mjs';
import { buildCommands } from './build.mjs';
import { bundlePart, fingerprintPart } from './fingerprint.mjs';
import { describeMarker, gitMarkerStore, markerName, markerStore } from './markers.mjs';
import { checkDeployOrder, gitHistory, neededBy } from './order.mjs';
import { MODES, decidePartDeploy, deployRelease, markApp, promotePart } from './procedure.mjs';
import {
	readBuildRecord,
	recordBuild,
	refuseForeignBuild,
	testFlagsSet,
	unreleasedRefusal,
} from './provenance.mjs';
import { recordRecoveryPoints } from './recovery.mjs';
import { readRelease } from './release.mjs';
import { requireSecrets, wranglerSecretNames, wranglerSourceConfig } from './secrets.mjs';
import { DeployVerifyFailure, verifyInstallation } from './verify.mjs';

const USAGE = `usage: keepr-deploy <command> --app <app> [--env <environment>]
  deploy --env <env> [--parts auto|always|never] [--artifact <dir>] [--override <reason>] [--unreleased <reason>]
                               build once (or place the artifact), then deploy order, D1 recovery point, parts, D1, Worker, verify,
                               each between markers; --override deploys out of order, --unreleased to production from a dirty
                               checkout or one that is no Release, each reason recorded
  build [--artifact <dir>]     the descriptor's build scripts only, the output copied to <dir>
  check                        each part bundled as a deploy would, then build: CI's Worker leg
  check --env <env>            the Installation's required Worker secrets, read from Cloudflare; builds nothing
  verify --env <env>           check the Installation serves this checkout's Release (KEEPR_DEPLOY_URL overrides its URL)
  gates --env <env>            the app's acceptance gates, against the Installation
  part <name> --env <env>      deploy one part between its markers, whatever its fingerprint
  mark-app <pending|deployed> --env <env>
                               write the app's marker by hand
  status --env <env>           the app's markers, and what a deploy of this checkout would do`;

/**
 * The checkout's root: the nearest directory above `cwd` with a `pnpm-workspace.yaml`.
 *
 * @param {string} cwd
 */
function workspaceRoot(cwd) {
	for (let directory = resolve(cwd); ; directory = dirname(directory)) {
		if (existsSync(join(directory, 'pnpm-workspace.yaml'))) return directory;
		if (dirname(directory) === directory)
			throw new Error(
				`no pnpm-workspace.yaml above ${cwd}: run keepr-deploy in a Release checkout.`,
			);
	}
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {string} cwd
 */
function run(command, args, cwd) {
	const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
	if (result.status !== 0) throw failed(command, args, result);
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {import('node:child_process').SpawnSyncReturns<unknown>} result
 */
function failed(command, args, result) {
	return new Error(
		`${command} ${args.join(' ')} failed${
			result.error ? `: ${result.error.message}` : ` with status ${result.status ?? result.signal}`
		}`,
	);
}

/**
 * What `command` printed to stdout, its stderr passed through.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {string} cwd
 */
function read(command, args, cwd) {
	const result = spawnSync(command, args, {
		cwd,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'inherit'],
	});
	if (result.status !== 0) throw failed(command, args, result);
	return result.stdout;
}

/**
 * The `KEY=value` lines of a `.env` file, as Nuxt reads them into a build;
 * none when it does not exist.
 *
 * @param {string} path
 * @returns {Record<string, string>}
 */
function dotEnv(path) {
	if (!existsSync(path)) return {};
	/** @type {Record<string, string>} */
	const values = {};
	for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
		const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
		if (match) values[match[1] ?? ''] = (match[2] ?? '').replace(/^(['"])(.*)\1$/, '$2');
	}
	return values;
}

/** @param {Record<string, string | undefined>} env */
function deployer(env) {
	return env.GITHUB_ACTIONS === 'true'
		? `actions ${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
		: 'local';
}

/**
 * The procedure's steps, done for real: `pnpm` and the Release's own `wrangler`
 * in the app's directory.
 *
 * @param {{
 *   release: import('./release.mjs').Release,
 *   environment: string,
 *   store: Pick<import('./markers.mjs').MarkerStore, 'head'>,
 *   env: Record<string, string | undefined>,
 *   log: (line: string) => void,
 * }} options
 * @returns {import('./procedure.mjs').DeploySteps & { bookmark: (binding: string) => string }}
 */
function realSteps({ release, environment, store, env, log }) {
	const { appDir, descriptor } = release;
	const wranglerEnv = descriptor.environments[environment]?.wranglerEnv;
	const envArgs = wranglerEnv === undefined ? [] : ['--env', wranglerEnv];
	const wrangler = join(appDir, 'node_modules/.bin/wrangler');
	return {
		// Beside the Accounts Stand-in when the app binds Keepr Accounts (`build.mjs`).
		build: () => {
			for (const { command, args } of buildCommands(release)) run(command, args, appDir);
			// The build reads the app's `.env` too, so a flag set there counts.
			recordBuild(release, {
				commit: store.head(),
				testFlags: testFlagsSet(descriptor, { ...dotEnv(join(appDir, '.env')), ...env }),
			});
		},
		placeArtifact: (path) => {
			const output = join(appDir, descriptor.output);
			rmSync(output, { recursive: true, force: true });
			cpSync(resolve(path), output, { recursive: true });
			if (!existsSync(join(appDir, descriptor.worker.config)))
				throw new Error(`the artifact at ${path} has no ${descriptor.worker.config}.`);
		},
		builtFrom: () => readBuildRecord(release),
		fingerprint: (part) => fingerprintPart({ appDir, part: descriptor.parts[part], wranglerEnv }),
		secretNames: wranglerSecretNames({ wrangler, appDir, wranglerEnv }),
		sourceConfig: wranglerSourceConfig({ appDir, wranglerEnv }),
		// A remote read: the database's current Time Travel bookmark, as JSON.
		bookmark: (binding) => {
			const output = read(
				wrangler,
				[
					'd1',
					'time-travel',
					'info',
					binding,
					'--json',
					'--config',
					descriptor.worker.config,
					...envArgs,
				],
				appDir,
			);
			return JSON.parse(output.slice(output.indexOf('{'))).bookmark;
		},
		deployPart: (part) =>
			run(wrangler, ['deploy', '--config', descriptor.parts[part].config, ...envArgs], appDir),
		migrate: (binding) =>
			run(
				wrangler,
				[
					'd1',
					'migrations',
					'apply',
					binding,
					'--remote',
					'--config',
					descriptor.worker.config,
					...envArgs,
				],
				appDir,
			),
		deployWorker: () =>
			run(wrangler, ['deploy', '--config', descriptor.worker.config, ...envArgs], appDir),
		// The Environment's URL, never KEEPR_DEPLOY_URL: a deploy verifies what it deployed.
		verify: () => verifyInstallation({ release, environment, commit: store.head(), log }),
	};
}

/**
 * The build's output, copied to `path` for the Deploy workflow to upload: what
 * `deploy --artifact` places back, in every Environment.
 *
 * @param {import('./release.mjs').Release} release
 * @param {string} path
 */
function exportArtifact({ appDir, descriptor }, path) {
	if (!existsSync(join(appDir, descriptor.worker.config)))
		throw new Error(`the build left no ${descriptor.worker.config} to deploy.`);
	rmSync(resolve(path), { recursive: true, force: true });
	cpSync(join(appDir, descriptor.output), resolve(path), { recursive: true });
}

/**
 * @param {import('./release.mjs').Release} release
 * @param {string} environment
 * @param {import('./markers.mjs').MarkerStore} store
 */
function markerLines(release, environment, store) {
	const names = [
		markerName(release.app, environment),
		...Object.keys(release.descriptor.parts).map((part) =>
			markerName(release.app, environment, part),
		),
	];
	return names.map((name) => `${name}: ${describeMarker(store.read(name))}`);
}

/**
 * @param {string[]} argv
 * @param {{ env?: Record<string, string | undefined>, cwd?: string }} [context]
 * @returns {Promise<number>} the exit code
 */
export async function main(argv, { env = process.env, cwd = process.cwd() } = {}) {
	let parsed;
	try {
		parsed = parseArgs({
			args: argv,
			allowPositionals: true,
			strict: true,
			options: {
				app: { type: 'string' },
				env: { type: 'string' },
				parts: { type: 'string', default: 'auto' },
				artifact: { type: 'string' },
				override: { type: 'string' },
				unreleased: { type: 'string' },
			},
		});
	} catch (error) {
		console.error(`${/** @type {Error} */ (error).message}\n${USAGE}`);
		return 2;
	}
	const { values, positionals } = parsed;
	const [command, argument, ...rest] = positionals;
	const environment = values.env;
	const needsEnv = command !== 'build' && command !== 'check';
	const { override, unreleased } = values;
	// A marker field is one line of text, and an override says why.
	const reasonReadable = (/** @type {string | undefined} */ reason) =>
		reason === undefined ||
		(command === 'deploy' && reason.trim() === reason && reason !== '' && !/[\r\n]/.test(reason));
	const overrideReadable = reasonReadable(override) && reasonReadable(unreleased);
	const shapes = {
		deploy: argument === undefined && MODES.includes(values.parts ?? ''),
		build: argument === undefined,
		check: argument === undefined,
		verify: argument === undefined,
		gates: argument === undefined,
		part: argument !== undefined,
		'mark-app': argument === 'pending' || argument === 'deployed',
		status: argument === undefined,
	};
	if (
		!(command in shapes) ||
		!shapes[/** @type {keyof typeof shapes} */ (command)] ||
		rest.length > 0 ||
		!overrideReadable ||
		values.app === undefined ||
		(needsEnv && environment === undefined)
	) {
		console.error(USAGE);
		return 2;
	}

	const summary = (/** @type {string} */ line) => {
		if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${line}\n`);
	};
	const log = (/** @type {string} */ line) => {
		console.log(line);
		summary(line);
	};

	let release;
	try {
		release = readRelease({ root: workspaceRoot(cwd), app: values.app });
	} catch (error) {
		console.error(`keepr-deploy: ${/** @type {Error} */ (error).message}`);
		return 1;
	}
	const source = deployer(env);

	if (command === 'build') {
		try {
			realSteps({
				release,
				environment: '',
				store: gitMarkerStore({ cwd: release.appDir }),
				env,
				log,
			}).build();
			if (values.artifact !== undefined) exportArtifact(release, values.artifact);
		} catch (error) {
			console.error(`keepr-deploy: ${/** @type {Error} */ (error).message}`);
			return 1;
		}
		return 0;
	}
	if (command === 'check' && environment !== undefined) {
		const { appDir, descriptor } = release;
		try {
			if (!descriptor.environments[environment])
				throw new Error(`${release.app} has no Installation in ${environment}.`);
			if (!existsSync(join(appDir, descriptor.worker.config)))
				throw new Error(
					`the app's Worker secrets are read through ${descriptor.worker.config}: build this checkout first (keepr-deploy build).`,
				);
			refuseForeignBuild(readBuildRecord(release), gitMarkerStore({ cwd: appDir }).head());
			const secretNames = wranglerSecretNames({
				wrangler: join(appDir, 'node_modules/.bin/wrangler'),
				appDir,
				wranglerEnv: descriptor.environments[environment].wranglerEnv,
			});
			requireSecrets({
				release,
				environment,
				secretNames,
				sourceConfig: wranglerSourceConfig({
					appDir,
					wranglerEnv: descriptor.environments[environment].wranglerEnv,
				}),
				log,
			});
		} catch (error) {
			console.error(`keepr-deploy: ${/** @type {Error} */ (error).message}`);
			return 1;
		}
		return 0;
	}
	if (command === 'check') {
		try {
			for (const [name, part] of Object.entries(release.descriptor.parts)) {
				const outDir = mkdtempSync(join(tmpdir(), 'keepr-part-check-'));
				try {
					bundlePart({ appDir: release.appDir, config: part.config, outDir });
				} finally {
					rmSync(outDir, { recursive: true, force: true });
				}
				log(`keepr-deploy: ${release.app}'s ${name} bundles.`);
			}
			realSteps({
				release,
				environment: '',
				store: gitMarkerStore({ cwd: release.appDir }),
				env,
				log,
			}).build();
		} catch (error) {
			console.error(`keepr-deploy: ${/** @type {Error} */ (error).message}`);
			return 1;
		}
		return 0;
	}
	const target = /** @type {string} */ (environment);
	if (command === 'deploy' || command === 'part') {
		try {
			refuseAccountMismatch({ release, environment: target, env });
		} catch (error) {
			console.error(`keepr-deploy: ${/** @type {Error} */ (error).message}`);
			return 1;
		}
	}
	const store = markerStore({ cwd: release.appDir });

	if (command === 'deploy') {
		const steps = realSteps({ release, environment: target, store, env, log });
		try {
			const unreleasedField = unreleasedRefusal({
				release,
				environment: target,
				dirty: store.dirty(),
				tagsAtHead: read('git', ['tag', '--points-at', 'HEAD'], release.appDir)
					.split('\n')
					.filter(Boolean),
				unreleased,
			});
			await deployRelease({
				release,
				environment: target,
				store,
				steps,
				...(values.artifact === undefined ? {} : { artifact: values.artifact }),
				mode: /** @type {import('./procedure.mjs').Mode} */ (values.parts),
				source,
				// Deploy order, then that a D1 recovery point exists: both before
				// anything remote changes.
				beforeRemoteChange: (context) => ({
					...unreleasedField,
					...checkDeployOrder({
						...context,
						history: gitHistory({ cwd: release.appDir }),
						...(override === undefined ? {} : { override }),
					}),
					...recordRecoveryPoints({ ...context, log: () => {}, bookmark: steps.bookmark }),
				}),
				// The point the marker records and a restore returns to: read
				// again once the parts are deployed, immediately before D1 migrates.
				beforeMigration: (context) =>
					recordRecoveryPoints({ ...context, bookmark: steps.bookmark }),
				log,
			});
		} catch (error) {
			log(
				`Deploy of ${release.app}@${release.version} to ${target} stopped: ${/** @type {Error} */ (error).message}. ` +
					'Markers now (apps/stream/README.md § Recovering from a partial promotion):',
			);
			try {
				for (const line of markerLines(release, target, store)) log(`- ${line}`);
			} catch (readError) {
				log(`- unread: ${/** @type {Error} */ (readError).message}; run keepr-deploy status`);
			}
			return 1;
		}
		return 0;
	}
	if (command === 'verify') {
		try {
			await verifyInstallation({
				release,
				environment: target,
				commit: store.head(),
				...(env.KEEPR_DEPLOY_URL ? { url: env.KEEPR_DEPLOY_URL } : {}),
			});
			return 0;
		} catch (error) {
			if (!(error instanceof DeployVerifyFailure)) throw error;
			console.error(`deploy:verify: FAILED: ${error.message}`);
			return 1;
		}
	}
	if (command === 'gates') {
		const installation = release.descriptor.environments[target];
		const gates = release.descriptor.gates ?? [];
		if (!installation) {
			console.error(`keepr-deploy: ${release.app} has no Installation in ${target}.`);
			return 1;
		}
		if (gates.length === 0) log(`${release.app}@${release.version} names no acceptance gates.`);
		for (const gate of gates) {
			const result = spawnSync('pnpm', ['run', gate], {
				cwd: release.appDir,
				env: { ...env, KEEPR_DEPLOY_URL: installation.url },
				stdio: 'inherit',
			});
			if (result.status !== 0) {
				log(
					`Acceptance gate ${gate} failed against ${installation.url}${result.error ? `: ${result.error.message}` : ''}.`,
				);
				return 1;
			}
			log(`Acceptance gate ${gate} passed against ${installation.url}.`);
		}
		return 0;
	}
	if (command === 'part') {
		const part = /** @type {string} */ (argument);
		const steps = realSteps({ release, environment: target, store, env, log });
		if (!release.descriptor.parts[part]) {
			console.error(`keepr-deploy: ${release.app} has no part ${JSON.stringify(part)}.`);
			return 1;
		}
		const recorded = promotePart({
			store,
			release,
			environment: target,
			part,
			fingerprint: () => steps.fingerprint(part),
			deploy: () => steps.deployPart(part),
			source,
		});
		console.log(
			`keepr-deploy: ${part} deployed; ${markerName(release.app, target, part)} records ${recorded}.`,
		);
		return 0;
	}
	if (command === 'mark-app') {
		const state = /** @type {'pending' | 'deployed'} */ (argument);
		let recorded;
		try {
			refuseForeignBuild(readBuildRecord(release), store.head());
		} catch (error) {
			console.error(
				`keepr-deploy: mark-app reads the built Worker: ${/** @type {Error} */ (error).message}`,
			);
			return 1;
		}
		try {
			recorded = neededBy(release, target);
		} catch (error) {
			console.error(
				`keepr-deploy: mark-app records what the built Worker needs, and cannot read it (${/** @type {Error} */ (error).message}): build this checkout first (keepr-deploy build).`,
			);
			return 1;
		}
		markApp({ store, release, environment: target, state, source, recorded });
		console.log(
			`keepr-deploy: ${markerName(release.app, target)} marker is ${state} at ${store.head()}.`,
		);
		return 0;
	}
	// status
	if (existsSync(join(release.appDir, release.descriptor.worker.config)))
		try {
			refuseForeignBuild(readBuildRecord(release), store.head());
		} catch (error) {
			console.error(`keepr-deploy: ${/** @type {Error} */ (error).message}`);
			return 1;
		}
	for (const line of markerLines(release, target, store)) console.log(line);
	const steps = realSteps({ release, environment: target, store, env, log });
	for (const part of Object.keys(release.descriptor.parts)) {
		const marker = markerName(release.app, target, part);
		let targetFingerprint;
		try {
			targetFingerprint = steps.fingerprint(part);
		} catch (error) {
			console.error(`keepr-deploy: ${/** @type {Error} */ (error).message}`);
		}
		const decision = decidePartDeploy({
			mode: 'auto',
			part,
			marker,
			targetFingerprint,
			markerText: store.read(marker),
		});
		console.log(
			`this checkout's ${part}: ${decision.deploy ? 'would deploy' : 'would not deploy'} (${decision.reason})`,
		);
	}
	return 0;
}

// `import.meta.main`: run as a workspace bin, `argv[1]` names the linked path.
if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
