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
 */

import { spawnSync } from 'node:child_process';

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
 * Refuse unless every Worker the Release deploys to `environment` has every
 * secret its descriptor requires. A Worker that requires none is not asked.
 *
 * @param {{
 *   release: import('./release.mjs').Release,
 *   environment: string,
 *   secretNames: (config: string) => string[] | null,
 *   log: (line: string) => void,
 * }} options `secretNames`: the names set on the Worker deployed from a
 *   configuration, null when it does not exist; it throws when they cannot be read.
 */
export function requireSecrets({ release, environment, secretNames, log }) {
	const { app, descriptor } = release;
	const wranglerEnv = descriptor.environments[environment]?.wranglerEnv;
	const workers = [
		{
			label: `${app}'s Worker`,
			config: descriptor.worker.config,
			required: descriptor.worker.secrets,
		},
		...Object.entries(descriptor.parts).map(([part, { config, secrets }]) => ({
			label: `${app}'s ${part}`,
			config,
			required: secrets,
		})),
	];
	const refusals = [];
	for (const { label, config, required = [] } of workers) {
		if (required.length === 0) continue;
		const put =
			`from apps/${app} with wrangler secret put <NAME> --config ${config}` +
			(wranglerEnv === undefined ? '' : ` --env ${wranglerEnv}`);
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
			refusals.push(
				`${label} does not exist in ${environment} yet, so it lacks ${required.join(', ')}: set each first, which creates it, ${put}`,
			);
			continue;
		}
		const missing = required.filter((name) => !set.includes(name));
		if (missing.length > 0) refusals.push(`${label} lacks ${missing.join(', ')}: set each ${put}`);
		else log(`${label} has its ${required.length} required secrets in ${environment}.`);
	}
	if (refusals.length > 0)
		throw new Error(
			`${app} in ${environment} is missing required Worker secrets: ${refusals.join('; ')}. Nothing was changed`,
		);
}
