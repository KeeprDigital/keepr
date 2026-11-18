/**
 * The secrets map (ADR-0134): `secrets.jsonc` at the workspace's root says where
 * 1Password keeps each secret's value, and holds no value.
 *
 * - `workers.<app>`: an app's Installations. `environments.<environment>` maps
 *   each Worker secret to its `op://<vault>/<item>/<field>` reference. The
 *   names are the deploy descriptor's `worker.secrets` (ADR-0128), plus the
 *   ones `optional` lists, which no deploy requires; the map adds only their
 *   location, and is refused when the two disagree. `generate` says, per
 *   secret, what generating a new value does (`warn`), or why it is never
 *   generated here (`refuse`); a secret it does not name is issued by a
 *   provider, not generated.
 * - `github.<environment>`: each secret of that GitHub environment, and its
 *   reference.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseJsonc } from '../jsonc.mjs';

export const SECRETS_MAP_FILE = 'secrets.jsonc';

/**
 * @typedef {{ warn: string } | { refuse: string }} Generation
 * @typedef {{
 *   workers: Record<string, {
 *     environments: Record<string, Record<string, string>>,
 *     optional?: string[],
 *     generate?: Record<string, Generation>,
 *   }>,
 *   github: Record<string, Record<string, string>>,
 * }} SecretsMap
 * @typedef {{ vault: string, item: string, field: string }} Reference
 * @typedef {{ name: string, ref: Reference, optional: boolean }} Secret
 */

/** @param {string} root the workspace's root @returns {SecretsMap} */
export function readSecretsMap(root) {
	const map = parseJsonc(readFileSync(join(root, SECRETS_MAP_FILE), 'utf8'));
	return { workers: map?.workers ?? {}, github: map?.github ?? {} };
}

const REFERENCE = /^op:\/\/([^/]+)\/([^/]+)\/([^/]+)$/;

/** @param {Reference} ref */
export const formatReference = ({ vault, item, field }) => `op://${vault}/${item}/${field}`;

/**
 * @param {Record<string, string>} references
 * @param {Set<string>} optional
 * @returns {Secret[]}
 */
function resolve(references, optional) {
	return Object.entries(references).map(([name, reference]) => {
		const match = typeof reference === 'string' ? REFERENCE.exec(reference) : null;
		if (!match)
			throw new Error(
				`${SECRETS_MAP_FILE}: ${name}'s ${JSON.stringify(reference)} is not an op://<vault>/<item>/<field> reference.`,
			);
		const [, vault, item, field] = /** @type {[string, string, string, string]} */ (match);
		return { name, ref: { vault, item, field }, optional: optional.has(name) };
	});
}

/**
 * The Worker secrets of `descriptor.app`'s Installation in `environment`: each
 * the descriptor requires, then each the map calls optional.
 *
 * @param {SecretsMap} map
 * @param {import('../deploy/release.mjs').Descriptor} descriptor
 * @param {string} environment
 * @returns {Secret[]}
 */
export function workerSecrets(map, descriptor, environment) {
	const { app } = descriptor;
	const entry = map.workers[app];
	const references = entry?.environments?.[environment];
	if (!references)
		throw new Error(`${SECRETS_MAP_FILE} names no secrets for ${app} in ${environment}.`);
	for (const [part, { secrets = [] }] of Object.entries(descriptor.parts))
		if (secrets.length > 0)
			throw new Error(
				`${app}'s part ${part} requires ${secrets.join(', ')}, and the sync sets only the app's Worker's secrets.`,
			);
	const required = descriptor.worker.secrets ?? [];
	const optional = new Set(entry.optional ?? []);
	const problems = [];
	const missing = required.filter((name) => !(name in references));
	if (missing.length > 0) problems.push(`it lacks ${missing.join(', ')}`);
	for (const name of required)
		if (optional.has(name)) problems.push(`${name} is required by the descriptor, so not optional`);
	for (const name of Object.keys(references))
		if (!required.includes(name) && !optional.has(name))
			problems.push(`${name} is neither required by the descriptor nor optional`);
	if (problems.length > 0)
		throw new Error(
			`${SECRETS_MAP_FILE} disagrees with apps/${app}/deploy.jsonc for ${environment}: ${problems.join('; ')}.`,
		);
	const secrets = resolve(references, optional);
	return [
		...required.map(
			(name) => /** @type {Secret} */ (secrets.find((secret) => secret.name === name)),
		),
		...secrets.filter((secret) => secret.optional),
	];
}

/**
 * The secrets of the GitHub environment `environment`.
 *
 * @param {SecretsMap} map
 * @param {string} environment
 * @returns {Secret[]}
 */
export function githubSecrets(map, environment) {
	const references = map.github[environment];
	if (!references)
		throw new Error(
			`${SECRETS_MAP_FILE} names no secrets for the GitHub environment ${environment}.`,
		);
	return resolve(references, new Set());
}

/**
 * What the map says of generating `name` for `app`'s Worker: how a new value
 * lands, or why it is refused.
 *
 * @param {SecretsMap} map
 * @param {string} app
 * @param {string} name
 * @returns {Generation}
 */
export function generation(map, app, name) {
	return (
		map.workers[app]?.generate?.[name] ?? {
			refuse: `${name} is issued by its provider, not generated: record the provider's value in 1Password`,
		}
	);
}
