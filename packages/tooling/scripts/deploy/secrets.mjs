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
 * deleted. A var the config leaves empty is a placeholder for a value nobody
 * has written yet, and refuses too.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseJsonc } from '../jsonc.mjs';
import { resolveWranglerConfig } from './fingerprint.mjs';

/** Wrangler's answer for a Worker the account does not have. */
const WORKER_NOT_FOUND = /\bWorker "[^"]+"(?: \(env: [^)]+\))? not found\./;

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
 * The vars each source Wrangler configuration in `appDir` sets for the
 * Environment's Wrangler block: the top level's, or the block's own, since
 * Wrangler does not inherit vars into one.
 *
 * @param {{ appDir: string, wranglerEnv: string | undefined }} options
 * @returns {(source: string) => Record<string, unknown>}
 */
export function wranglerVars({ appDir, wranglerEnv }) {
	return (source) =>
		resolveWranglerConfig(parseJsonc(readFileSync(join(appDir, source), 'utf8')), wranglerEnv)
			.vars ?? {};
}

/**
 * Refuse unless every Worker the Release deploys to `environment` has every
 * secret its descriptor requires, no secret named like a var its configuration
 * sets there, and no var left empty. A Worker that requires no secret and sets
 * no var is not asked.
 *
 * @param {{
 *   release: import('./release.mjs').Release,
 *   environment: string,
 *   secretNames: (config: string) => string[] | null,
 *   configuredVars: (source: string) => Record<string, unknown>,
 *   log: (line: string) => void,
 * }} options `secretNames`: the names set on the Worker deployed from a
 *   configuration, null when it does not exist; it throws when they cannot be
 *   read. `configuredVars`: the vars a source configuration sets for the
 *   Environment (`wranglerVars`).
 */
export function requireSecrets({ release, environment, secretNames, configuredVars, log }) {
	const { app, descriptor } = release;
	const wranglerEnv = descriptor.environments[environment]?.wranglerEnv;
	const workers = [
		{
			label: `${app}'s Worker`,
			source: descriptor.worker.source,
			config: descriptor.worker.config,
			required: descriptor.worker.secrets,
		},
		...Object.entries(descriptor.parts).map(([part, { config, secrets }]) => ({
			label: `${app}'s ${part}`,
			source: config,
			config,
			required: secrets,
		})),
	];
	const refusals = [];
	for (const { label, source, config, required = [] } of workers) {
		const configured = configuredVars(source);
		const vars = Object.keys(configured);
		const empty = vars.filter(
			(name) => typeof configured[name] === 'string' && configured[name].trim() === '',
		);
		if (empty.length > 0)
			refusals.push(
				`${label}: ${source} leaves ${empty.join(', ')} empty for ${environment}, a placeholder: set its value`,
			);
		if (required.length === 0 && vars.length === 0) continue;
		const flags = `--config ${config}` + (wranglerEnv === undefined ? '' : ` --env ${wranglerEnv}`);
		const put = `from apps/${app} with wrangler secret put <NAME> ${flags}`;
		let set;
		try {
			set = secretNames(config);
		} catch (error) {
			refusals.push(
				`could not read ${label}'s secrets in ${environment}: ${/** @type {Error} */ (error).message}`,
			);
			continue;
		}
		if (set === null) {
			if (required.length > 0)
				refusals.push(
					`${label} does not exist in ${environment} yet, so it lacks ${required.join(', ')}: set each first, which creates it, ${put}`,
				);
			continue;
		}
		const shadowed = vars.filter((name) => set.includes(name));
		if (shadowed.length > 0)
			refusals.push(
				`${label} has a secret and a var both named ${shadowed.join(', ')}: delete each secret from apps/${app} with wrangler secret delete <NAME> ${flags}`,
			);
		const missing = required.filter((name) => !set.includes(name));
		if (missing.length > 0) refusals.push(`${label} lacks ${missing.join(', ')}: set each ${put}`);
		else if (required.length > 0)
			log(`${label} has its ${required.length} required secrets in ${environment}.`);
	}
	if (refusals.length > 0)
		throw new Error(
			`${app} in ${environment} is refused for its Worker secrets and vars: ${refusals.join('; ')}. Nothing was changed`,
		);
}
