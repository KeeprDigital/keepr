/**
 * A part's build fingerprint (ADR-0035, ADR-0119): a sha256 over what
 * `wrangler deploy` would upload and build for it in one Environment. A part is
 * a Worker an app deploys from source beside its own, such as Stream Keepr's
 * silent-video validator; its marker records the fingerprint, and the next
 * deploy skips the part while the fingerprint is unchanged.
 *
 * The fingerprint hashes:
 *
 * - the bundle wrangler would upload (every module it writes, not its source
 *   maps or README), so any import it resolves counts, a root dependency among
 *   them;
 * - every file of the Container's Docker context, when the part has one;
 * - the Worker configuration **resolved for the Environment**: the top level
 *   with that Environment's `env` block over it, as canonical JSON. Another
 *   Environment's block, comments and layout are not part of it, so a
 *   staging-only edit never redeploys production's part.
 *
 * A Release's version bump touches none of them.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { parseJsonc } from '../jsonc.mjs';

/** @param {string | Buffer} bytes */
function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

/** @param {string} directory */
function filesBelow(directory) {
	return readdirSync(directory, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => join(entry.parentPath, entry.name));
}

/**
 * JSON with every object's keys sorted, so equal values hash equal.
 *
 * @param {unknown} value
 * @returns {string}
 */
function canonicalJson(value) {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	if (value !== null && typeof value === 'object')
		return `{${Object.keys(value)
			.toSorted()
			.map(
				(key) =>
					`${JSON.stringify(key)}:${canonicalJson(/** @type {Record<string, unknown>} */ (value)[key])}`,
			)
			.join(',')}}`;
	return JSON.stringify(value);
}

/**
 * A Wrangler configuration as one Environment sees it: the top level, with the
 * Environment's `env` block over it when it names one. Wrangler does not
 * inherit every key into an `env` block; this does, which can only count more
 * than the Environment uses, never less.
 *
 * @param {Record<string, unknown> & { env?: Record<string, Record<string, unknown>> }} config
 * @param {string} [wranglerEnv] the `env` block to resolve, none for the top level
 */
export function resolveWranglerConfig(config, wranglerEnv) {
	const { env, ...topLevel } = config;
	if (wranglerEnv === undefined) return topLevel;
	const block = env?.[wranglerEnv];
	if (!block)
		throw new Error(`the Wrangler configuration has no env.${wranglerEnv} block to deploy.`);
	return { ...topLevel, ...block };
}

/**
 * Bundle a part as `wrangler deploy` would upload it, into the absolute
 * `outDir`, without Docker or credentials. It runs the checkout's own
 * wrangler, so a Release is bundled by the wrangler it pins.
 *
 * @param {{ appDir: string, config: string, wranglerEnv?: string, outDir: string }} options
 */
export function bundlePart({ appDir, config, wranglerEnv, outDir }) {
	const result = spawnSync(
		join(appDir, 'node_modules/.bin/wrangler'),
		[
			'deploy',
			'--dry-run',
			'--containers-rollout=none',
			'--config',
			config,
			...(wranglerEnv === undefined ? [] : ['--env', wranglerEnv]),
			// Absolute: a relative --outdir resolves against the config's directory.
			'--outdir',
			outDir,
		],
		{ cwd: appDir, encoding: 'utf8' },
	);
	if (result.status !== 0)
		throw new Error(
			`could not bundle ${config}: ${result.error?.message ?? `${result.stdout}${result.stderr}`.trim()}`,
		);
}

/**
 * @typedef {{ config: string, container?: string, secrets?: string[] }} Part
 *   paths relative to the app's directory: the part's Wrangler configuration,
 *   and its Container's Docker context when it has one
 */

/**
 * @param {{
 *   appDir: string,
 *   part: Part,
 *   wranglerEnv?: string,
 *   bundle?: (options: { appDir: string, config: string, wranglerEnv?: string, outDir: string }) => void,
 * }} options
 * @returns {string} `sha256:<hex>`
 */
export function fingerprintPart({ appDir, part, wranglerEnv, bundle = bundlePart }) {
	const config = resolveWranglerConfig(
		parseJsonc(readFileSync(join(appDir, part.config), 'utf8')),
		wranglerEnv,
	);
	const outDir = mkdtempSync(join(tmpdir(), 'keepr-part-fingerprint-'));
	try {
		bundle({ appDir, config: part.config, wranglerEnv, outDir });
		const context = part.container === undefined ? undefined : join(appDir, part.container);
		const entries = [
			...filesBelow(outDir)
				.filter((path) => !path.endsWith('.map') && relative(outDir, path) !== 'README.md')
				.map((path) => `bundle/${relative(outDir, path)}\0${sha256(readFileSync(path))}`),
			...(context === undefined
				? []
				: filesBelow(context).map(
						(path) => `container/${relative(context, path)}\0${sha256(readFileSync(path))}`,
					)),
			`config\0${sha256(canonicalJson(config))}`,
		];
		return `sha256:${sha256(
			entries
				.toSorted()
				.map((entry) => `${entry}\n`)
				.join(''),
		)}`;
	} finally {
		rmSync(outDir, { recursive: true, force: true });
	}
}
