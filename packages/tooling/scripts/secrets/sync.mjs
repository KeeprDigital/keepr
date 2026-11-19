/**
 * `pnpm secrets:sync` (ADR-0134): 1Password is the record of every secret's
 * value, and this sets each where it is used, from the secrets map
 * (`map.mjs`): an app Installation's Worker, with `wrangler secret bulk`
 * against the Environment's Wrangler config, which names the account
 * (ADR-0130), or a GitHub environment, with `gh secret set --env`.
 *
 * It reads 1Password with the `op` CLI, one item at a time. A field with no
 * value is not recorded yet: it is never set, and is named. `check` sets
 * nothing, and names what the destination lacks; Cloudflare and GitHub answer
 * names, never values, so a value that differs cannot be seen.
 *
 * `generate` names Worker secrets that are random by nature: each gets a new
 * value (`openssl rand -base64 32`'s), written into 1Password first and read
 * back from it, then synced with the rest; one 1Password does not hold is
 * synced nowhere. Only a secret the map says may be generated is, and the
 * map's warning of what a new value does is logged first.
 *
 * No value is ever logged or left in an error. Each goes to its tool on stdin,
 * but a generated one, which `op` takes only as an argument (ADR-0135).
 */

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { resolveWranglerConfig } from '../deploy/fingerprint.mjs';
import { readRelease } from '../deploy/release.mjs';
import { WORKER_NOT_FOUND } from '../deploy/secrets.mjs';
import { parseJsonc } from '../jsonc.mjs';
import {
	formatReference,
	generation,
	githubSecrets,
	readSecretsMap,
	workerSecrets,
} from './map.mjs';

/**
 * @typedef {import('./map.mjs').Secret} Secret
 * @typedef {{
 *   label: string,
 *   names: () => string[] | null,
 *   set: (values: Record<string, string>) => void,
 * }} Destination `names`: the secret names set there, null when it does not
 *   exist yet; `set` writes every value given.
 * @typedef {{ app: string, environment: string } | { github: string }} Target
 */

/**
 * Every value read or generated, so no error a tool prints can carry one.
 */
class Redactor {
	/** @type {Set<string>} */
	values = new Set();

	/** @param {string} text */
	scrub(text) {
		let scrubbed = text;
		for (const value of this.values)
			if (value !== '') scrubbed = scrubbed.split(value).join('<redacted>');
		return scrubbed;
	}
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd: string, env: NodeJS.ProcessEnv, input?: string, redactor: Redactor }} options
 * @returns {string} what it printed
 */
function run(command, args, { cwd, env, input, redactor }) {
	const result = spawnSync(command, args, {
		cwd,
		env,
		input,
		encoding: 'utf8',
		// `op` reads piped input as what to act on, so a command given none has no stdin.
		stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
		maxBuffer: 16 * 1024 * 1024,
	});
	if (result.status === 0) return result.stdout ?? '';
	const said = `${result.stderr ?? ''}\n${result.stdout ?? ''}`;
	const line = said
		.split('\n')
		.map((text) => text.trim())
		.find(Boolean);
	const why = result.error
		? result.error.message
		: (line ?? `status ${result.status ?? result.signal}`);
	const error = new Error(
		redactor.scrub(`${command.split('/').pop()} ${args.slice(0, 2).join(' ')} failed: ${why}`),
	);
	Object.assign(error, { said: redactor.scrub(said) });
	throw error;
}

/**
 * 1Password, through the `op` CLI: each item read once, as JSON.
 *
 * @param {{ root: string, env: NodeJS.ProcessEnv, redactor: Redactor }} options
 */
function onePassword({ root, env, redactor }) {
	/** @type {Map<string, any>} */
	const items = new Map();
	/** @param {import('./map.mjs').Reference} ref */
	const itemOf = ({ vault, item }) => {
		const key = `${vault}/${item}`;
		if (!items.has(key)) {
			const json = run(
				'op',
				['item', 'get', item, '--vault', vault, '--format', 'json', '--reveal'],
				{
					cwd: root,
					env,
					redactor,
				},
			);
			const parsed = JSON.parse(json);
			for (const field of parsed.fields ?? [])
				if (typeof field.value === 'string') redactor.values.add(field.value);
			items.set(key, parsed);
		}
		return items.get(key);
	};
	/** @param {import('./map.mjs').Reference} ref */
	const fieldOf = (ref) => {
		const fields = (itemOf(ref).fields ?? []).filter(
			(/** @type {{ label?: string }} */ field) => field.label === ref.field,
		);
		if (fields.length !== 1)
			throw new Error(
				`1Password item ${ref.item} in ${ref.vault} has ${fields.length === 0 ? 'no' : 'more than one'} field ${ref.field} (${formatReference(ref)}).`,
			);
		return fields[0];
	};
	return {
		/** @param {import('./map.mjs').Reference} ref @returns {string} '' when not recorded */
		read: (ref) => {
			const value = fieldOf(ref).value;
			return typeof value === 'string' ? value : '';
		},
		/** @param {import('./map.mjs').Reference} ref @param {string} value */
		write: (ref, value) => {
			redactor.values.add(value);
			fieldOf(ref);
			// op 2.42 exits 0 on an item's JSON piped in, and keeps no concealed value from it
			// (ADR-0135), so the value is an assignment, in its field's existing section.
			const label = ref.field.replace(/[\\.=]/g, '\\$&');
			run('op', ['item', 'edit', ref.item, '--vault', ref.vault, `${label}[password]=${value}`], {
				cwd: root,
				env,
				redactor,
			});
			// Read back fresh: op's exit status alone once let a value reach only a Worker.
			items.delete(`${ref.vault}/${ref.item}`);
			if (fieldOf(ref).value !== value)
				throw new Error(
					`1Password did not keep the new ${ref.field} at ${formatReference(ref)}: op item edit succeeded, but the field does not hold it. Nothing was set on the destination.`,
				);
		},
	};
}

/**
 * The Worker of `release`'s Installation in `environment`, through its own
 * Wrangler and its source config, which names the Environment's account. A
 * config that leaves naming the Worker to the build takes the descriptor's
 * `worker.name`.
 *
 * @param {{
 *   release: import('../deploy/release.mjs').Release,
 *   environment: string,
 *   env: NodeJS.ProcessEnv,
 *   redactor: Redactor,
 * }} options
 * @returns {Destination}
 */
function workerDestination({ release, environment, env, redactor }) {
	const { app, appDir, descriptor } = release;
	const { source } = descriptor.worker;
	const wranglerEnv = descriptor.environments[environment]?.wranglerEnv;
	const configured = resolveWranglerConfig(
		parseJsonc(readFileSync(join(appDir, source), 'utf8')),
		wranglerEnv,
	).name;
	const name = configured ?? descriptor.worker.name;
	if (name === undefined)
		throw new Error(
			`Neither apps/${app}/${source}${wranglerEnv ? ` (env.${wranglerEnv})` : ''} nor its deploy descriptor's worker.name names ${app}'s Worker.`,
		);
	// Wrangler names `--name x --env y` Worker x-y, so an env block names its own.
	if (configured === undefined && wranglerEnv !== undefined)
		throw new Error(`apps/${app}/${source}'s env.${wranglerEnv} names no Worker.`);
	const args = [
		'--config',
		source,
		...(wranglerEnv === undefined ? [] : ['--env', wranglerEnv]),
		...(configured === undefined ? ['--name', name] : []),
	];
	const wrangler = join(appDir, 'node_modules/.bin/wrangler');
	return {
		label: `Worker ${name} (apps/${app}/${source}${wranglerEnv ? ` --env ${wranglerEnv}` : ''})`,
		names: () => {
			let listed;
			try {
				listed = run(wrangler, ['secret', 'list', '--format', 'json', ...args], {
					cwd: appDir,
					env,
					redactor,
				});
			} catch (error) {
				if (WORKER_NOT_FOUND.test(/** @type {{ said?: string }} */ (error).said ?? '')) return null;
				throw error;
			}
			return JSON.parse(listed.slice(listed.indexOf('['))).map(
				(/** @type {{ name: string }} */ secret) => secret.name,
			);
		},
		set: (values) => {
			run(wrangler, ['secret', 'bulk', ...args], {
				cwd: appDir,
				env,
				input: JSON.stringify(values),
				redactor,
			});
		},
	};
}

/**
 * The GitHub environment `environment` of the repository `gh` infers from `root`.
 *
 * @param {{ root: string, environment: string, env: NodeJS.ProcessEnv, redactor: Redactor }} options
 * @returns {Destination}
 */
function githubDestination({ root, environment, env, redactor }) {
	return {
		label: `GitHub environment ${environment}`,
		names: () =>
			JSON.parse(
				run('gh', ['secret', 'list', '--env', environment, '--json', 'name'], {
					cwd: root,
					env,
					redactor,
				}),
			).map((/** @type {{ name: string }} */ secret) => secret.name),
		set: (values) => {
			for (const [name, value] of Object.entries(values))
				run('gh', ['secret', 'set', name, '--env', environment], {
					cwd: root,
					env,
					input: value,
					redactor,
				});
		},
	};
}

/** @param {Secret} secret */
const describe = (secret) =>
	`${secret.name}${secret.optional ? ' (optional)' : ''} at ${formatReference(secret.ref)}`;

/**
 * Set every secret of `target` that 1Password records, or with `check`, only
 * say what is missing.
 *
 * @param {{
 *   root: string,
 *   target: Target,
 *   check?: boolean,
 *   generate?: string[],
 *   env?: NodeJS.ProcessEnv,
 *   log: (line: string) => void,
 * }} options `env`: added to this process's environment for each tool.
 * @returns {{ ok: boolean }} not ok when a secret no Installation can go
 *   without is not recorded, or with `check`, not set
 */
export function syncSecrets({ root, target, check = false, generate = [], env = {}, log }) {
	const childEnv = { ...process.env, ...env };
	const redactor = new Redactor();
	const map = readSecretsMap(root);
	/** @type {Secret[]} */
	let secrets;
	/** @type {Destination} */
	let destination;
	/** @type {string} */
	let title;
	if ('github' in target) {
		if (generate.length > 0)
			throw new Error(
				'Only a Worker secret is generated; a GitHub secret comes from its provider.',
			);
		secrets = githubSecrets(map, target.github);
		destination = githubDestination({ root, environment: target.github, env: childEnv, redactor });
		title = destination.label;
	} else {
		const release = readRelease({ root, app: target.app });
		if (!(target.environment in release.descriptor.environments))
			throw new Error(`${target.app} has no Installation in ${target.environment}.`);
		secrets = workerSecrets(map, release.descriptor, target.environment);
		destination = workerDestination({
			release,
			environment: target.environment,
			env: childEnv,
			redactor,
		});
		title = `${target.app} in ${target.environment}`;
	}

	/** @type {{ secret: Secret, warn: string }[]} */
	const generated = [];
	if (generate.length > 0) {
		if (check) throw new Error('--check writes nothing, so it generates nothing.');
		const { app } = /** @type {{ app: string }} */ (target);
		const refusals = [];
		for (const name of generate) {
			const secret = secrets.find((candidate) => candidate.name === name);
			const plan = generation(map, app, name);
			if (!secret) refusals.push(`${name} is not one of ${title}'s secrets`);
			else if ('refuse' in plan) refusals.push(`${name}: ${plan.refuse}`);
			else generated.push({ secret, warn: plan.warn });
		}
		if (refusals.length > 0)
			throw new Error(`Refusing to generate: ${refusals.join('; ')}. Nothing was changed.`);
	}

	log(title === destination.label ? `${title}.` : `${title}: ${destination.label}.`);
	const vault = onePassword({ root, env: childEnv, redactor });
	for (const { secret, warn } of generated) {
		log(`Warning: ${warn}.`);
		vault.write(secret.ref, randomBytes(32).toString('base64'));
		log(`Generated ${secret.name} into ${formatReference(secret.ref)}.`);
	}
	/** @type {Map<string, string>} */
	const values = new Map(secrets.map((secret) => [secret.name, vault.read(secret.ref)]));
	const unrecorded = secrets.filter((secret) => values.get(secret.name) === '');
	let ok = !unrecorded.some((secret) => !secret.optional);

	if (check) {
		const set = destination.names();
		if (set === null) log(`${destination.label} does not exist yet.`);
		const missing = secrets.filter((secret) => !(set ?? []).includes(secret.name));
		if (missing.length > 0)
			log(`Missing on ${destination.label}: ${missing.map(describe).join(', ')}.`);
		const unmapped = (set ?? []).filter((name) => !secrets.some((secret) => secret.name === name));
		if (unmapped.length > 0) log(`Set there, but not in the secrets map: ${unmapped.join(', ')}.`);
		ok &&= !missing.some((secret) => !secret.optional);
		log(
			'Cloudflare and GitHub answer names only, so a value that differs from 1Password cannot be seen.',
		);
	} else {
		const recorded = secrets.filter((secret) => values.get(secret.name) !== '');
		if (recorded.length > 0) {
			destination.set(
				Object.fromEntries(
					recorded.map((secret) => [secret.name, /** @type {string} */ (values.get(secret.name))]),
				),
			);
			log(`Set ${recorded.map((secret) => secret.name).join(', ')} on ${destination.label}.`);
		} else log('1Password records none of them, so nothing was set.');
	}
	if (unrecorded.length > 0)
		log(`Not recorded in 1Password, so not set: ${unrecorded.map(describe).join(', ')}.`);
	return { ok };
}
