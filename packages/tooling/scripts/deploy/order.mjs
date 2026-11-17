/**
 * Deploy order between Keepr Accounts and its Apps (ADR-0120), checked before a
 * deploy's first remote change.
 *
 * - **Who depends on Keepr Accounts is derived**: an App whose built Worker
 *   configuration, as the target Environment deploys it, binds the
 *   `keepr-accounts` service. Its app marker records `needs: accounts`, so a
 *   later deploy of Keepr Accounts knows what each Installation needs.
 * - **An App waits for Keepr Accounts**: its deploy to E refuses unless
 *   `accounts/E` records a confirmed deploy whose commit contains every change
 *   under `apps/accounts` the App's Release commit contains.
 * - **Keepr Accounts cannot fall below its Apps**: its deploy to E refuses a
 *   commit lacking an `apps/accounts` change that the commit of some dependent
 *   Installation in E contains.
 * - **Override**: a written reason bypasses either refusal, and the app marker
 *   records it as `override`.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseJsonc } from '../jsonc.mjs';
import { markerName, parseMarker } from './markers.mjs';

/** Keepr Accounts: its app's name, the service an App binds, and where its changes are. */
export const KEEPR_ACCOUNTS = Object.freeze({
	app: 'accounts',
	service: 'keepr-accounts',
	path: 'apps/accounts',
});

/** How many missing changes a refusal names before it stops. */
const MAX_LISTED = 5;

/**
 * What the check reads of the repository's history.
 *
 * @typedef {{
 *   missing: (from: string, to: string, path: string) => string[],
 * }} History `missing`: the commits reachable from `from` and not from `to`
 *   that change `path`, newest first, each `<short sha> <subject>`.
 */

/**
 * The repository's history through `git`, run in `cwd`. A shallow clone
 * cannot answer what a commit contains, so it refuses.
 *
 * @param {{ cwd: string }} options
 * @returns {History}
 */
export function gitHistory({ cwd }) {
	/** @param {string[]} args */
	const git = (args) => {
		const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
		if (result.status !== 0)
			throw new Error(
				`git ${args.join(' ')} failed: ${result.error?.message ?? result.stderr.trim()}`,
			);
		return result.stdout;
	};
	return {
		missing(from, to, path) {
			if (git(['rev-parse', '--is-shallow-repository']).trim() === 'true')
				throw new Error(
					'the deploy order check needs the full history, and this checkout is shallow: fetch it with fetch-depth 0.',
				);
			return git(['log', '--format=%h %s', from, `^${to}`, '--', `:(top)${path}`])
				.split('\n')
				.filter(Boolean);
		},
	};
}

/**
 * Whether the Release's built Worker binds Keepr Accounts in `environment`.
 * Service bindings are not inherited into a Wrangler `env` block, so an
 * Environment deployed from one reads that block's alone.
 *
 * @param {import('./release.mjs').Release} release
 * @param {string} environment
 */
export function bindsKeeprAccounts(release, environment) {
	const { appDir, descriptor } = release;
	const config = parseJsonc(readFileSync(join(appDir, descriptor.worker.config), 'utf8'));
	const wranglerEnv = descriptor.environments[environment]?.wranglerEnv;
	const services =
		wranglerEnv === undefined ? config.services : config.env?.[wranglerEnv]?.services;
	return (
		Array.isArray(services) &&
		services.some((/** @type {any} */ binding) => binding?.service === KEEPR_ACCOUNTS.service)
	);
}

/**
 * What the app's marker records of what its Installation in `environment`
 * needs: `needs: accounts` when its built Worker binds Keepr Accounts there.
 *
 * @param {import('./release.mjs').Release} release
 * @param {string} environment
 * @returns {Record<string, string>}
 */
export function neededBy(release, environment) {
	return release.app !== KEEPR_ACCOUNTS.app && bindsKeeprAccounts(release, environment)
		? { needs: KEEPR_ACCOUNTS.app }
		: {};
}

/** @param {string[]} changes */
function listed(changes) {
	const shown = changes.slice(0, MAX_LISTED).join('; ');
	return changes.length > MAX_LISTED ? `${shown}; and ${changes.length - MAX_LISTED} more` : shown;
}

/** @param {string} commit */
const short = (commit) => commit.slice(0, 12);

/**
 * Why `release` may not deploy to `environment` yet, if it may not.
 *
 * @param {{
 *   release: import('./release.mjs').Release,
 *   environment: string,
 *   store: import('./markers.mjs').MarkerStore,
 *   history: History,
 * }} options
 * @returns {string[]}
 */
function appRefusals({ release, environment, store, history }) {
	const name = markerName(KEEPR_ACCOUNTS.app, environment);
	const text = store.read(name);
	const accounts = text === undefined ? undefined : parseMarker(text);
	if (accounts?.state !== 'deployed' || !accounts.commit)
		return [
			`${release.app} binds Keepr Accounts, and ${name} records no confirmed deploy (${
				text === undefined ? 'missing' : (accounts?.state ?? 'unreadable')
			}): deploy Keepr Accounts to ${environment} first`,
		];
	const missing = history.missing(store.head(), accounts.commit, KEEPR_ACCOUNTS.path);
	if (missing.length === 0) return [];
	return [
		`${name} (${short(accounts.commit)}) lacks ${missing.length} Keepr Accounts change(s) this ${release.app} Release contains: ${listed(missing)}. Deploy Keepr Accounts to ${environment} first`,
	];
}

/**
 * Why Keepr Accounts may not deploy this commit to `environment`: each
 * Installation there whose marker records that it needs Keepr Accounts, and
 * whose commit holds a Keepr Accounts change this one lacks. A pending
 * Installation counts: either of its Releases may be serving.
 *
 * @param {{
 *   environment: string,
 *   store: import('./markers.mjs').MarkerStore,
 *   history: History,
 * }} options
 * @returns {string[]}
 */
function accountsRefusals({ environment, store, history }) {
	const installation = new RegExp(`^([a-z]+(?:-[a-z]+)*)/${environment}$`);
	const refusals = [];
	for (const name of store.names().toSorted()) {
		const app = installation.exec(name)?.[1];
		if (app === undefined || app === KEEPR_ACCOUNTS.app) continue;
		const text = store.read(name);
		const marker = text === undefined ? undefined : parseMarker(text);
		if (
			!marker?.commit ||
			!['deployed', 'pending'].includes(marker.state) ||
			!(marker.needs ?? '').split(',').includes(KEEPR_ACCOUNTS.app)
		)
			continue;
		const missing = history.missing(marker.commit, store.head(), KEEPR_ACCOUNTS.path);
		if (missing.length > 0)
			refusals.push(
				`${name} (${marker.state} ${short(marker.commit)}) needs Keepr Accounts and contains ${missing.length} Keepr Accounts change(s) this commit lacks: ${listed(missing)}. Deploy a Keepr Accounts Release that contains them`,
			);
	}
	return refusals;
}

/**
 * Check deploy order for `release` to `environment`, before anything remote
 * changes. Throws to refuse; answers the fields the app's marker records.
 *
 * @param {{
 *   release: import('./release.mjs').Release,
 *   environment: string,
 *   store: import('./markers.mjs').MarkerStore,
 *   history: History,
 *   override?: string,
 *   log: (line: string) => void,
 * }} options `override`: the written reason to deploy whatever the order.
 * @returns {Record<string, string>}
 */
export function checkDeployOrder({ release, environment, store, history, override, log }) {
	const fields = neededBy(release, environment);
	const refusals =
		release.app === KEEPR_ACCOUNTS.app
			? accountsRefusals({ environment, store, history })
			: fields.needs
				? appRefusals({ release, environment, store, history })
				: [];
	if (refusals.length === 0) {
		if (override !== undefined)
			log(`deploy order: nothing to override; the marker does not record "${override}".`);
		return fields;
	}
	if (override !== undefined) {
		for (const refusal of refusals) log(`deploy order overridden (${override}): ${refusal}.`);
		return { ...fields, override };
	}
	throw new Error(`deploy order: ${refusals.join('; ')}, or deploy with --override <reason>.`);
}
