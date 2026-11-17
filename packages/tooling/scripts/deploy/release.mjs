/**
 * The Release being deployed, read from its own checkout (ADR-0119): the app,
 * its directory and version, and its **deploy descriptor**, `apps/<app>/deploy.jsonc`,
 * which states what is deployed. The tooling does the deploying.
 *
 * Whether an app has a descriptor is what makes it deployable: Changesets
 * versions only those apps, and CI builds each one's Worker.
 *
 * A Release cut before descriptors (`@keepr/stream@1.6.0`, `@keepr/stream@1.7.0`)
 * has none, and a rollback still deploys it: it reads as the descriptor Stream
 * Keepr had then, `PRE_DESCRIPTOR_RELEASES`, and is verified for liveness only,
 * since it predates `/api/release` too.
 *
 * The Accounts Stand-in never deploys (ADR-0113): a Release whose descriptor
 * would upload any Worker configuration under a package marked
 * `keepr.undeployable` is refused before anything is built.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { undeployableReason } from '../deploy-guard.mjs';
import { parseJsonc } from '../jsonc.mjs';

export const DESCRIPTOR_FILE = 'deploy.jsonc';

/**
 * What a deploy descriptor states.
 *
 * - `app`: the app's name, its package's without `@keepr/`; markers and `/api/release` use it.
 * - `build`: the app's package scripts that build it and check the build (a
 *   wrangler dry run, a Worker smoke), in order. They run once; every
 *   Environment deploys what they built.
 * - `output`: the directory they build into, which a downloaded artifact replaces.
 * - `worker.config`: the built Worker's Wrangler configuration.
 * - `databases`: the D1 bindings whose migrations apply before the Worker deploys.
 * - `environments`: each Environment the app has an Installation in, with the
 *   Installation's URL and, when it is not the configuration's top level, the
 *   Wrangler `env` block it deploys.
 * - `parts`: Workers deployed from source beside the app, each with its own
 *   marker and fingerprint, deployed first when their fingerprint changed.
 *
 * Paths are relative to the app's directory.
 *
 * @typedef {{
 *   app: string,
 *   build: string[],
 *   output: string,
 *   worker: { config: string },
 *   databases: { binding: string }[],
 *   environments: Record<string, { url: string, wranglerEnv?: string }>,
 *   parts: Record<string, import('./fingerprint.mjs').Part>,
 * }} Descriptor
 */

/**
 * @typedef {{
 *   app: string,
 *   appDir: string,
 *   version: string,
 *   descriptor: Descriptor,
 *   verifies: 'release' | 'liveness',
 * }} Release
 *   `verifies`: what a deploy of it checks once it is live: its release identity
 *   at `/api/release`, or, for a Release from before that, liveness at `/api/time`.
 */

/** Stream Keepr as it was deployed before descriptors, by the scripts its Releases then had. */
const STREAM_BEFORE_DESCRIPTORS = Object.freeze({
	app: 'stream',
	build: ['build', 'worker:dry-run', 'worker:smoke'],
	output: '.output',
	worker: { config: '.output/server/wrangler.json' },
	databases: [{ binding: 'DB' }],
	environments: { production: { url: 'https://stream.keepr.digital' } },
	parts: {
		validator: {
			config: 'workers/silent-video-validator/wrangler.jsonc',
			container: 'workers/silent-video-validator/container',
		},
	},
});

/** @type {ReadonlyMap<string, Descriptor>} */
export const PRE_DESCRIPTOR_RELEASES = new Map([['stream', STREAM_BEFORE_DESCRIPTORS]]);

const NAME = /^[a-z]+$/;
const APP_NAME = /^[a-z]+(?:-[a-z]+)*$/;
const SCRIPT = /^[a-z][a-z0-9:-]*$/;

/** @param {unknown} value */
const isText = (value) => typeof value === 'string' && value !== '';
/** @param {unknown} value @returns {value is Record<string, any>} */
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** @param {string} url */
function isHttpUrl(url) {
	try {
		return ['http:', 'https:'].includes(new URL(url).protocol);
	} catch {
		return false;
	}
}

/**
 * Every way the descriptor fails to say what is deployed.
 *
 * @param {any} descriptor
 * @param {string} app the app it must name
 * @returns {string[]}
 */
function descriptorProblems(descriptor, app) {
	if (!isObject(descriptor)) return ['it is not an object'];
	const problems = [];
	if (descriptor.app !== app)
		problems.push(`it names app ${JSON.stringify(descriptor.app)}, not ${JSON.stringify(app)}`);
	if (!Array.isArray(descriptor.build) || !descriptor.build.every((step) => SCRIPT.test(step)))
		problems.push('build is not a list of package script names');
	if (!isText(descriptor.output)) problems.push('output is not a directory');
	if (!isText(descriptor.worker?.config)) problems.push('worker.config is not a path');
	if (
		!Array.isArray(descriptor.databases) ||
		!descriptor.databases.every((/** @type {any} */ db) => isText(db?.binding))
	)
		problems.push('databases is not a list of { binding }');
	const environments = isObject(descriptor.environments)
		? Object.entries(descriptor.environments)
		: [];
	if (environments.length === 0) problems.push('environments names none');
	for (const [name, environment] of environments) {
		if (!NAME.test(name)) problems.push(`Environment ${JSON.stringify(name)} is not [a-z]+`);
		if (!isHttpUrl(environment?.url)) problems.push(`${name}.url is not an http(s) URL`);
		if (environment?.wranglerEnv !== undefined && !isText(environment.wranglerEnv))
			problems.push(`${name}.wranglerEnv is not a name`);
	}
	if (!isObject(descriptor.parts)) problems.push('parts is not an object');
	else
		for (const [name, part] of Object.entries(descriptor.parts)) {
			if (!NAME.test(name)) problems.push(`part ${JSON.stringify(name)} is not [a-z]+`);
			if (!isText(part?.config)) problems.push(`parts.${name}.config is not a path`);
			if (part?.container !== undefined && !isText(part.container))
				problems.push(`parts.${name}.container is not a path`);
		}
	return problems;
}

/** @param {string} path */
function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * The Release of `app` in the checkout at `root`, ready to deploy, or an error
 * saying why it is not.
 *
 * @param {{ root: string, app: string }} options
 * @returns {Release}
 */
export function readRelease({ root, app }) {
	if (!APP_NAME.test(app)) throw new Error(`${JSON.stringify(app)} is not an app's name.`);
	const appDir = join(root, 'apps', app);
	const manifestPath = join(appDir, 'package.json');
	const descriptorPath = join(appDir, DESCRIPTOR_FILE);
	const hasDescriptor = existsSync(descriptorPath);
	const fallback = PRE_DESCRIPTOR_RELEASES.get(app);
	if (!existsSync(manifestPath) || (!hasDescriptor && !fallback))
		throw new Error(
			`${app} is not deployable from this Release: it has no apps/${app}/${DESCRIPTOR_FILE}.`,
		);
	const manifest = readJson(manifestPath);
	const descriptor = hasDescriptor
		? parseJsonc(readFileSync(descriptorPath, 'utf8'))
		: structuredClone(fallback);
	const problems = descriptorProblems(descriptor, app);
	if (manifest.name !== `@keepr/${app}`)
		problems.push(`its package is ${JSON.stringify(manifest.name)}, not "@keepr/${app}"`);
	if (!isText(manifest.version)) problems.push('its package.json names no version');
	if (problems.length > 0)
		throw new Error(`apps/${app}/${DESCRIPTOR_FILE} cannot deploy: ${problems.join('; ')}.`);

	for (const config of [
		'package.json',
		descriptor.worker.config,
		...Object.values(descriptor.parts).map((/** @type {{ config: string }} */ part) => part.config),
	]) {
		const reason = undeployableReason(join(appDir, config));
		if (reason) throw new Error(`Refusing to deploy ${app}: ${config} is undeployable: ${reason}`);
	}

	return {
		app,
		appDir,
		version: manifest.version,
		descriptor,
		verifies: hasDescriptor ? 'release' : 'liveness',
	};
}

/**
 * The apps in the checkout at `root` that have a deploy descriptor.
 *
 * @param {string} root
 * @returns {string[]}
 */
export function deployableApps(root) {
	return readdirSync(join(root, 'apps'), { withFileTypes: true })
		.filter(
			(entry) => entry.isDirectory() && existsSync(join(root, 'apps', entry.name, DESCRIPTOR_FILE)),
		)
		.map((entry) => entry.name)
		.toSorted();
}
