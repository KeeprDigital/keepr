/**
 * The deploy procedure (ADR-0119): one Release of one app to one Environment.
 *
 * 1. Build once, or place a downloaded artifact of that build: the descriptor's
 *    `build` scripts (build, wrangler dry run, Worker smoke) run here, and
 *    nowhere else. Then the deploy guard reads every Worker configuration it
 *    will upload, as built or placed: none may be under a package marked
 *    `keepr.undeployable`, the Accounts Stand-in's mark (ADR-0113).
 * 2. Refuse an Installation whose Workers lack a secret the descriptor
 *    requires (`secrets.mjs`, ADR-0128), read from Cloudflare, or have a
 *    secret named like a var their config sets (ADR-0132).
 * 3. Decide each part against its marker by fingerprint.
 * 4. `beforeRemoteChange`: the last moment a deploy can refuse with nothing
 *    changed. Deploy order between apps (`order.mjs`, ADR-0120) refuses here,
 *    and what it answers the app's markers record.
 * 5. Each part that the decision deploys, between its `pending` and `deployed`
 *    markers.
 * 6. The app: mark pending, migrate D1, deploy the Worker, verify, mark deployed.
 * 7. Retire the markers from before per-app names whose replacement now
 *    records a confirmed deploy.
 *
 * A pending marker is the state a deploy leaves when it dies part-way: it
 * claims nothing, and the next decision does not trust it. Writing it first is
 * also what keeps an emergency local deploy honest, because one that cannot
 * write its marker never starts.
 *
 * It runs from the tooling at the workflow's commit against the Release's
 * checkout, and never calls a Release's own `pnpm run deploy`. Every side
 * effect is a step the caller hands in (`cli.mjs` spawns `pnpm` and the
 * Release's own `wrangler`), so the procedure is tested against Cloudflare and
 * the marker remote in memory.
 */

import { join } from 'node:path';
import { undeployableReason } from '../deploy-guard.mjs';
import { LEGACY_MARKERS, formatMarker, markerName, parseMarker } from './markers.mjs';
import { requireSecrets } from './secrets.mjs';

const FINGERPRINT = /^sha256:[0-9a-f]{64}$/;
/** How a deploy treats its parts: decide by fingerprint, or force either way. */
export const MODES = ['auto', 'always', 'never'];

/**
 * @typedef {'auto' | 'always' | 'never'} Mode
 * @typedef {import('./release.mjs').Release} Release
 * @typedef {import('./markers.mjs').MarkerStore} MarkerStore
 * @typedef {{ deploy: boolean, reason: string }} Decision
 */

/**
 * What a deploy does to the world, each a step the procedure orders.
 * `secretNames` reads, and changes nothing: the secret names set on the Worker
 * deployed from a configuration, null when it does not exist.
 * `configuredVars` reads the vars a source configuration sets for the
 * Environment, from the Release's checkout.
 *
 * @typedef {{
 *   build: () => void,
 *   placeArtifact: (path: string) => void,
 *   fingerprint: (part: string) => string,
 *   secretNames: (config: string) => string[] | null,
 *   configuredVars: (source: string) => Record<string, unknown>,
 *   deployPart: (part: string) => void,
 *   migrate: (binding: string) => void,
 *   deployWorker: () => void,
 *   verify: () => Promise<unknown>,
 * }} DeploySteps
 */

/**
 * What the check before the first remote change is told. It throws to refuse,
 * or answers fields for the app's markers to record (`[a-z]+` names, one-line
 * values), appended after every field the procedure writes.
 *
 * @typedef {{ release: Release, environment: string, store: MarkerStore, log: (line: string) => void }} RemoteChangeContext
 * @typedef {(context: RemoteChangeContext) => void | Record<string, string> | Promise<void | Record<string, string>>} BeforeRemoteChange
 */

/**
 * Whether a deploy of the target Release deploys a part.
 *
 * @param {{
 *   mode: Mode,
 *   part: string,
 *   marker: string,
 *   targetFingerprint: string | undefined,
 *   markerText: string | undefined,
 * }} input `part` is the part its marker's `component` field names and `marker` the marker's
 *   name; `targetFingerprint` is undefined when the target could not be
 *   fingerprinted; `markerText` is the marker tag's message, undefined when no
 *   marker exists.
 * @returns {Decision}
 */
export function decidePartDeploy({ mode, part, marker, targetFingerprint, markerText }) {
	if (mode === 'always') return { deploy: true, reason: 'forced by the always mode' };
	if (mode === 'never') return { deploy: false, reason: 'suppressed by the never mode' };
	if (!MODES.includes(mode))
		throw new Error(`unknown mode ${JSON.stringify(mode)}; expected ${MODES.join(', ')}.`);
	if (targetFingerprint === undefined)
		return {
			deploy: true,
			reason: `the target ${part} could not be fingerprinted; deploying is the safe default`,
		};
	if (markerText === undefined)
		return { deploy: true, reason: `no ${marker} marker exists; deploying is the safe default` };
	const fields = parseMarker(markerText);
	if (
		!fields ||
		fields.component !== part ||
		!['deployed', 'pending'].includes(fields.state) ||
		!FINGERPRINT.test(fields.fingerprint ?? '')
	) {
		return {
			deploy: true,
			reason: `the ${marker} marker is unreadable or its fingerprint unknown; deploying is the safe default`,
		};
	}
	if (fields.state === 'pending')
		return {
			deploy: true,
			reason: `the ${part} deploy of ${fields.commit} started but was never confirmed; deploying is the safe default`,
		};
	if (fields.fingerprint === targetFingerprint)
		return {
			deploy: false,
			reason: `${part} fingerprint unchanged since the deployed ${fields.commit}`,
		};
	return {
		deploy: true,
		reason: `${part} fingerprint changed since the deployed ${fields.commit}`,
	};
}

/**
 * @param {MarkerStore} store
 * @param {string} name
 * @param {{
 *   component: string,
 *   state: 'pending' | 'deployed',
 *   fingerprint?: string,
 *   source: string,
 *   release: Release,
 *   environment: string,
 *   recorded?: Record<string, string>,
 * }} fields `recorded`: what the check before the first remote change answered.
 */
function writeMarker(
	store,
	name,
	{ component, state, fingerprint, source, release, environment, recorded = {} },
) {
	const commit = store.head();
	/** @type {Record<string, string>} */
	const fields = {
		component,
		state,
		commit,
		worktree: store.dirty() ? 'dirty' : 'clean',
		...(fingerprint ? { fingerprint } : {}),
		source,
		app: release.app,
		environment,
		version: release.version,
	};
	for (const field of Object.keys(recorded))
		if (field in fields || field === 'fingerprint')
			throw new Error(`the ${field} field is the procedure's own; a check cannot record it.`);
	store.write(name, commit, formatMarker({ ...fields, ...recorded }));
}

/**
 * @param {() => string} fingerprint
 * @param {(line: string) => void} log
 */
function tryFingerprint(fingerprint, log) {
	try {
		return fingerprint();
	} catch (error) {
		log(`deploy: ${/** @type {Error} */ (error).message}`);
		return undefined;
	}
}

/**
 * Record the app's deploy to an Environment: `pending` before its first remote
 * change, `deployed` once verify passed.
 *
 * @param {{
 *   store: MarkerStore,
 *   release: Release,
 *   environment: string,
 *   state: 'pending' | 'deployed',
 *   source: string,
 *   recorded?: Record<string, string>,
 * }} options `recorded`: fields the marker records after the procedure's own.
 */
export function markApp({ store, release, environment, state, source, recorded }) {
	writeMarker(store, markerName(release.app, environment), {
		component: 'app',
		state,
		source,
		release,
		environment,
		...(recorded ? { recorded } : {}),
	});
}

/**
 * Deploy one part between its two markers: `pending` first, so a deploy that
 * dies at any point leaves a marker the next decision distrusts, and
 * `deployed` only after `deploy` returned. A pending marker that cannot be
 * written stops the deploy before it starts.
 *
 * @param {{
 *   store: MarkerStore,
 *   release: Release,
 *   environment: string,
 *   part: string,
 *   fingerprint: () => string,
 *   deploy: () => void,
 *   source: string,
 *   log?: (line: string) => void,
 * }} options
 * @returns {string} the fingerprint recorded, `unknown` when there was none
 */
export function promotePart({
	store,
	release,
	environment,
	part,
	fingerprint,
	deploy,
	source,
	log = console.error,
}) {
	const name = markerName(release.app, environment, part);
	const target = tryFingerprint(fingerprint, log) ?? 'unknown';
	const fields = { component: part, fingerprint: target, source, release, environment };
	writeMarker(store, name, { ...fields, state: 'pending' });
	deploy();
	writeMarker(store, name, { ...fields, state: 'deployed' });
	return target;
}

/**
 * Remove each marker from before per-app names whose replacement, among
 * `names`, now records a confirmed deploy.
 *
 * @param {MarkerStore} store
 * @param {string[]} names
 * @returns {string[]} the markers removed
 */
function retireLegacyMarkers(store, names) {
	const retired = [];
	for (const name of names) {
		const legacy = LEGACY_MARKERS.get(name);
		if (legacy === undefined || store.read(legacy) === undefined) continue;
		const text = store.read(name);
		if (text === undefined || parseMarker(text)?.state !== 'deployed') continue;
		store.remove(legacy);
		retired.push(legacy);
	}
	return retired;
}

/**
 * Refuse a Release whose built or placed Worker configuration, or a part's,
 * sits under a package marked `keepr.undeployable`. `readRelease` refuses the
 * configurations the descriptor names before building; this reads what will
 * actually be uploaded.
 *
 * @param {Release} release
 */
function refuseUndeployable({ app, appDir, descriptor }) {
	for (const config of [
		descriptor.worker.config,
		...Object.values(descriptor.parts).map((part) => part.config),
	]) {
		const reason = undeployableReason(join(appDir, config));
		if (reason) throw new Error(`Refusing to deploy ${app}: ${config} is undeployable: ${reason}`);
	}
}

/**
 * Deploy `release` to `environment`. Any failure throws, leaving the markers
 * saying only what is confirmed.
 *
 * @param {{
 *   release: Release,
 *   environment: string,
 *   store: MarkerStore,
 *   steps: DeploySteps,
 *   artifact?: string,
 *   mode?: Mode,
 *   source: string,
 *   beforeRemoteChange?: BeforeRemoteChange,
 *   log?: (line: string) => void,
 * }} options `artifact`: a downloaded build of this Release, deployed instead
 *   of building it; `beforeRemoteChange` throws to refuse the deploy, or
 *   answers fields the app's markers record.
 * @returns {Promise<{ parts: Record<string, Decision>, verified: unknown, retired: string[] }>}
 */
export async function deployRelease({
	release,
	environment,
	store,
	steps,
	artifact,
	mode = 'auto',
	source,
	beforeRemoteChange = () => {},
	log = console.log,
}) {
	const { app, descriptor } = release;
	if (!descriptor.environments[environment])
		throw new Error(
			`${app} has no Installation in ${environment}: its descriptor names ${Object.keys(descriptor.environments).join(', ')}.`,
		);

	if (artifact === undefined) steps.build();
	else steps.placeArtifact(artifact);
	refuseUndeployable(release);
	requireSecrets({
		release,
		environment,
		secretNames: steps.secretNames,
		configuredVars: steps.configuredVars,
		log,
	});

	/** @type {Record<string, Decision & { fingerprint?: string }>} */
	const parts = {};
	for (const part of Object.keys(descriptor.parts)) {
		const marker = markerName(app, environment, part);
		const targetFingerprint =
			mode === 'never' ? undefined : tryFingerprint(() => steps.fingerprint(part), log);
		parts[part] = {
			...decidePartDeploy({
				mode,
				part,
				marker,
				targetFingerprint,
				markerText: store.read(marker),
			}),
			...(targetFingerprint === undefined ? {} : { fingerprint: targetFingerprint }),
		};
		log(`${marker}: deploy ${parts[part].deploy} (${parts[part].reason})`);
	}

	const recorded = (await beforeRemoteChange({ release, environment, store, log })) ?? {};

	for (const [part, decision] of Object.entries(parts)) {
		if (!decision.deploy) continue;
		promotePart({
			store,
			release,
			environment,
			part,
			fingerprint: () => decision.fingerprint ?? 'unknown',
			deploy: () => steps.deployPart(part),
			source,
			log,
		});
	}

	markApp({ store, release, environment, state: 'pending', source, recorded });
	for (const { binding } of descriptor.databases) steps.migrate(binding);
	steps.deployWorker();
	const verified = await steps.verify();
	markApp({ store, release, environment, state: 'deployed', source, recorded });

	const retired = retireLegacyMarkers(store, [
		markerName(app, environment),
		...Object.keys(descriptor.parts).map((part) => markerName(app, environment, part)),
	]);
	for (const name of retired)
		log(`Retired the ${name} marker: its replacement records this deploy.`);

	return {
		parts: Object.fromEntries(
			Object.entries(parts).map(([part, { deploy, reason }]) => [part, { deploy, reason }]),
		),
		verified,
		retired,
	};
}
