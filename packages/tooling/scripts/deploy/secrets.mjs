/**
 * The Worker secrets an Installation requires (ADR-0128): each Worker the
 * descriptor deploys names them (`worker.secrets`, `parts.<name>.secrets`),
 * and a deploy reads the names set on the target Worker before its first
 * remote change, refusing with every one missing and the command that sets
 * it. Values are never read; Cloudflare answers only names.
 *
 * A Worker that does not exist yet has no secrets, so the first deploy of a
 * new Installation refuses too: `wrangler secret put` creates the Worker, and
 * its secrets are set before it is first deployed.
 *
 * A name is a var or a secret, never both (ADR-0132): a var the Environment's
 * Wrangler config sets beside a Worker secret of that name leaves which one the
 * Worker reads to Cloudflare, so the deploy refuses until the secret is
 * deleted.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseJsonc } from '../jsonc.mjs';
import { resolveWranglerConfig } from './fingerprint.mjs';

/** Wrangler's answer for a Worker the account does not have. */
export const WORKER_NOT_FOUND = /\bWorker "[^"]+"(?: \(env: [^)]+\))? not found\./;

/**
 * The secret names set on the Worker deployed from each configuration, as
 * Wrangler lists them (`wrangler secret list --format json`) in `appDir`, for
 * the Environment's Wrangler block.
 *
 * @param {{ wrangler: string, appDir: string, wranglerEnv: string | undefined }} options
 * @returns {(config: string) => string[] | null} null when the Worker does not
 *   exist; it throws when Wrangler cannot answer
 */
export function wranglerSecretNames({ wrangler, appDir, wranglerEnv }) {
	const envArgs = wranglerEnv === undefined ? [] : ['--env', wranglerEnv];
	return (config) => {
		const result = spawnSync(
			wrangler,
			['secret', 'list', '--format', 'json', '--config', config, ...envArgs],
			{ cwd: appDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
		);
		const said = `${result.stderr ?? ''}\n${result.stdout ?? ''}`;
		if (result.status !== 0) {
			if (WORKER_NOT_FOUND.test(said)) return null;
			const line = said
				.split('\n')
				.map((text) => text.trim())
				.find(Boolean);
			throw new Error(
				`wrangler secret list failed${result.error ? `: ${result.error.message}` : line ? `: ${line}` : ` with status ${result.status ?? result.signal}`}`,
			);
		}
		const stdout = result.stdout ?? '';
		let listed;
		try {
			listed = JSON.parse(stdout.slice(stdout.indexOf('[')));
		} catch {
			listed = undefined;
		}
		if (
			!Array.isArray(listed) ||
			!listed.every((/** @type {any} */ secret) => typeof secret?.name === 'string')
		)
			throw new Error('wrangler secret list answered no list of secrets');
		return listed.map((/** @type {{ name: string }} */ secret) => secret.name);
	};
}

/**
 * Each source Wrangler configuration in `appDir`, as the Environment's Wrangler
 * block resolves it: the top level, with the block's own fields over it.
 *
 * @param {{ appDir: string, wranglerEnv: string | undefined }} options
 * @returns {(source: string) => SourceConfig}
 * @typedef {{ name?: unknown, vars?: Record<string, unknown> }} SourceConfig
 */
export function wranglerSourceConfig({ appDir, wranglerEnv }) {
	return (source) =>
		resolveWranglerConfig(parseJsonc(readFileSync(join(appDir, source), 'utf8')), wranglerEnv);
}

/**
 * How a command a person runs, or `pnpm secrets:sync`, reaches the Worker
 * deployed from `source` in an Environment: through the source configuration,
 * whose blocks name each account (ADR-0130), with the Environment's block, and
 * `--name` where the configuration leaves naming the Worker to the build. Never
 * the built configuration, which exists only beside a build and may be another
 * commit's (`apps/stream/README.md` § Worker secrets).
 *
 * @param {{
 *   app: string,
 *   label: string,
 *   source: string,
 *   wranglerEnv: string | undefined,
 *   config: SourceConfig,
 *   name?: string,
 * }} options `config`: `source` resolved for the Environment
 *   (`wranglerSourceConfig`). `name`: the Worker's, where `source` names none
 *   (the descriptor's `worker.name`).
 * @returns {{ name: string, args: string[] }} the Worker's name, and the
 *   arguments that reach it; it throws when neither names the Worker
 */
export function workerTarget({ app, label, source, wranglerEnv, config, name }) {
	const configured = typeof config.name === 'string' ? config.name : undefined;
	const worker = configured ?? name;
	if (worker === undefined)
		throw new Error(
			`Neither apps/${app}/${source}${wranglerEnv === undefined ? '' : ` (env.${wranglerEnv})`} nor its deploy descriptor names ${label}.`,
		);
	// Wrangler names `--name x --env y` Worker x-y, so an env block names its own.
	if (configured === undefined && wranglerEnv !== undefined)
		throw new Error(`apps/${app}/${source}'s env.${wranglerEnv} names no Worker.`);
	return {
		name: worker,
		args: [
			'--config',
			source,
			...(wranglerEnv === undefined ? [] : ['--env', wranglerEnv]),
			...(configured === undefined ? ['--name', worker] : []),
		],
	};
}

/**
 * Refuse unless every Worker the Release deploys to `environment` has every
 * secret its descriptor requires, and no secret named like a var its
 * configuration sets there. A Worker that requires no secret and sets no var
 * is not asked. Each refusal names the command that mends it through the
 * Worker's source configuration (`workerTarget`): the tooling reads through the
 * built one under an Environment's own token, but a person runs the hint.
 *
 * @param {{
 *   release: import('./release.mjs').Release,
 *   environment: string,
 *   secretNames: (config: string) => string[] | null,
 *   sourceConfig: (source: string) => SourceConfig,
 *   log: (line: string) => void,
 * }} options `secretNames`: the names set on the Worker deployed from a
 *   configuration, null when it does not exist; it throws when they cannot be
 *   read. `sourceConfig`: a source configuration as the Environment resolves
 *   it (`wranglerSourceConfig`).
 */
export function requireSecrets({ release, environment, secretNames, sourceConfig, log }) {
	const { app, descriptor } = release;
	const wranglerEnv = descriptor.environments[environment]?.wranglerEnv;
	const workers = [
		{
			label: `${app}'s Worker`,
			source: descriptor.worker.source,
			config: descriptor.worker.config,
			name: descriptor.worker.name,
			required: descriptor.worker.secrets,
			synced: true,
		},
		...Object.entries(descriptor.parts).map(([part, { config, secrets }]) => ({
			label: `${app}'s ${part}`,
			source: config,
			config,
			name: undefined,
			required: secrets,
			synced: false,
		})),
	];
	const refusals = [];
	for (const { label, source, config, name, required = [], synced } of workers) {
		const resolved = sourceConfig(source);
		const vars = Object.keys(resolved.vars ?? {});
		if (required.length === 0 && vars.length === 0) continue;
		// The app's Worker's secrets are set from 1Password (ADR-0134).
		const put = (/** @type {string} */ flags) =>
			(synced ? `with pnpm secrets:sync --app ${app} --env ${environment}, or ` : '') +
			`from apps/${app} with wrangler secret put <NAME> ${flags}`;
		let set;
		try {
			set = secretNames(config);
		} catch (error) {
			refusals.push(
				`could not read ${label}'s secrets in ${environment}: ${/** @type {Error} */ (error).message}`,
			);
			continue;
		}
		/** @type {((flags: string) => string)[]} */
		const found = [];
		if (set === null) {
			if (required.length > 0)
				found.push(
					(flags) =>
						`${label} does not exist in ${environment} yet, so it lacks ${required.join(', ')}: set each first, which creates it, ${put(flags)}`,
				);
		} else {
			const shadowed = vars.filter((key) => set.includes(key));
			if (shadowed.length > 0)
				found.push(
					(flags) =>
						`${label} has a secret and a var both named ${shadowed.join(', ')}: delete each secret from apps/${app} with wrangler secret delete <NAME> ${flags}`,
				);
			const missing = required.filter((secret) => !set.includes(secret));
			if (missing.length > 0)
				found.push((flags) => `${label} lacks ${missing.join(', ')}: set each ${put(flags)}`);
			else if (required.length > 0)
				log(`${label} has its ${required.length} required secrets in ${environment}.`);
		}
		if (found.length === 0) continue;
		let flags;
		try {
			flags = workerTarget({ app, label, source, wranglerEnv, config: resolved, name }).args;
		} catch (error) {
			refusals.push(
				`${label} is refused in ${environment}, and no command reaches it: ${/** @type {Error} */ (error).message.replace(/\.$/, '')}`,
			);
			continue;
		}
		refusals.push(...found.map((say) => say(flags.join(' '))));
	}
	if (refusals.length > 0)
		throw new Error(
			`${app} in ${environment} is refused for its Worker secrets and vars: ${refusals.join('; ')}. Nothing was changed`,
		);
}
