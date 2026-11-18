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
 * Commands:
 *
 * - `deploy`: build once (or place `--artifact`), then for the Environment:
 *   parts by fingerprint (`--parts auto|always|never`), deploy order between
 *   Keepr Accounts and its Apps (`order.mjs`; `--override <reason>` bypasses
 *   it, and the app's marker records the reason), each D1 database's Time
 *   Travel bookmark (`recovery.mjs`; refused without one, and recorded in the
 *   app's marker), mark pending, migrate D1, deploy, verify, mark deployed
 *   (`procedure.mjs`).
 * - `build [--artifact <dir>]`: the descriptor's build scripts only, into its
 *   output directory, copied to `--artifact` for a build job to upload: the
 *   one build every Environment deploys (`deploy --artifact`).
 * - `check`: what CI checks of each deployable app's Worker: each part bundled
 *   as a deploy would upload it (no Docker, no credentials), then `build`.
 * - `verify`: check the Installation serves this checkout's Release.
 * - `part <name>`: deploy one part between its markers, whatever its fingerprint.
 * - `mark-app <pending|deployed>`: write the app's marker by hand, recording
 *   whether its built Worker needs Keepr Accounts, as a deploy would.
 * - `status`: every marker of the app in the Environment, and what a deploy of
 *   this checkout would do with each part.
 */

import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { bundlePart, fingerprintPart } from './fingerprint.mjs';
import { LEGACY_MARKERS, describeMarker, gitMarkerStore, markerName } from './markers.mjs';
import { checkDeployOrder, gitHistory, neededBy } from './order.mjs';
import { MODES, decidePartDeploy, deployRelease, markApp, promotePart } from './procedure.mjs';
import { recordRecoveryPoints } from './recovery.mjs';
import { readRelease } from './release.mjs';
import { DeployVerifyFailure, verifyInstallation } from './verify.mjs';

const USAGE = `usage: keepr-deploy <command> --app <app> [--env <environment>]
  deploy --env <env> [--parts auto|always|never] [--artifact <dir>] [--override <reason>]
                               build once (or place the artifact), then deploy order, D1 recovery point, parts, D1, Worker, verify,
                               each between markers; --override deploys out of order, its reason recorded
  build [--artifact <dir>]     the descriptor's build scripts only, the output copied to <dir>
  check                        each part bundled as a deploy would, then build: CI's Worker leg
  verify --env <env>           check the Installation serves this checkout's Release
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
 *   store: import('./markers.mjs').MarkerStore,
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
		build: () => {
			for (const script of descriptor.build) run('pnpm', ['run', script], appDir);
		},
		placeArtifact: (path) => {
			const output = join(appDir, descriptor.output);
			rmSync(output, { recursive: true, force: true });
			cpSync(resolve(path), output, { recursive: true });
			if (!existsSync(join(appDir, descriptor.worker.config)))
				throw new Error(`the artifact at ${path} has no ${descriptor.worker.config}.`);
		},
		fingerprint: (part) => fingerprintPart({ appDir, part: descriptor.parts[part], wranglerEnv }),
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
		verify: () => verifyInstallation({ release, environment, commit: store.head(), env, log }),
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
	const lines = names.map((name) => `${name}: ${describeMarker(store.read(name))}`);
	for (const name of names) {
		const legacy = LEGACY_MARKERS.get(name);
		const text = legacy === undefined ? undefined : store.read(legacy);
		if (text !== undefined)
			lines.push(
				`${legacy}: ${describeMarker(text)} (before per-app names; a deploy that confirms ${name} removes it)`,
			);
	}
	return lines;
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
	const override = values.override;
	// A marker field is one line of text, and an override says why.
	const overrideReadable =
		override === undefined ||
		(command === 'deploy' &&
			override.trim() === override &&
			override !== '' &&
			!/[\r\n]/.test(override));
	const shapes = {
		deploy: argument === undefined && MODES.includes(values.parts ?? ''),
		build: argument === undefined,
		check: argument === undefined,
		verify: argument === undefined,
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
	const store = gitMarkerStore({ cwd: release.appDir });

	if (command === 'deploy') {
		const steps = realSteps({ release, environment: target, store, env, log });
		try {
			await deployRelease({
				release,
				environment: target,
				store,
				steps,
				...(values.artifact === undefined ? {} : { artifact: values.artifact }),
				mode: /** @type {import('./procedure.mjs').Mode} */ (values.parts),
				source,
				// Deploy order, then the D1 recovery point: both before anything remote changes.
				beforeRemoteChange: (context) => ({
					...checkDeployOrder({
						...context,
						history: gitHistory({ cwd: release.appDir }),
						...(override === undefined ? {} : { override }),
					}),
					...recordRecoveryPoints({ ...context, bookmark: steps.bookmark }),
				}),
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
			await verifyInstallation({ release, environment: target, commit: store.head(), env });
			return 0;
		} catch (error) {
			if (!(error instanceof DeployVerifyFailure)) throw error;
			console.error(`deploy:verify: FAILED: ${error.message}`);
			return 1;
		}
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
