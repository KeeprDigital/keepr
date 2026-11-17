/**
 * The deploy procedure (ADR-0119): one Release of one app to one Environment.
 *
 * 1. Build once, or place a downloaded artifact of that build: the descriptor's
 *    `build` scripts (build, wrangler dry run, Worker smoke) run here, and
 *    nowhere else.
 * 2. Decide each part against its marker by fingerprint.
 * 3. `beforeRemoteChange`: the last moment a deploy can refuse with nothing
 *    changed. Deploy order between apps (#1263) refuses here.
 * 4. Each part that the decision deploys, between its `pending` and `deployed`
 *    markers.
 * 5. The app: mark pending, migrate D1, deploy the Worker, verify, mark deployed.
 * 6. Retire the markers from before per-app names whose replacement now
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

import { LEGACY_MARKERS, formatMarker, markerName, parseMarker } from './markers.mjs';

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
 *
 * @typedef {{
 *   build: () => void,
 *   placeArtifact: (path: string) => void,
 *   fingerprint: (part: string) => string,
 *   deployPart: (part: string) => void,
 *   migrate: (binding: string) => void,
 *   deployWorker: () => void,
 *   verify: () => Promise<unknown>,
 * }} DeploySteps
 */

/**
 * What the check before the first remote change is told.
 *
 * @typedef {{ release: Release, environment: string, store: MarkerStore, log: (line: string) => void }} RemoteChangeContext
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
 * }} input `part` is the component its marker records and `marker` the marker's
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
 * }} fields
 */
function writeMarker(store, name, { component, state, fingerprint, source, release, environment }) {
	const commit = store.head();
	store.write(
		name,
		commit,
		formatMarker({
			component,
			state,
			commit,
			worktree: store.dirty() ? 'dirty' : 'clean',
			...(fingerprint ? { fingerprint } : {}),
			source,
			app: release.app,
			environment,
			version: release.version,
		}),
	);
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
 * }} options
 */
export function markApp({ store, release, environment, state, source }) {
	writeMarker(store, markerName(release.app, environment), {
		component: 'app',
		state,
		source,
		release,
		environment,
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
 *   beforeRemoteChange?: (context: RemoteChangeContext) => void | Promise<void>,
 *   log?: (line: string) => void,
 * }} options `artifact`: a downloaded build of this Release, deployed instead
 *   of building it; `beforeRemoteChange` throws to refuse the deploy.
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

	await beforeRemoteChange({ release, environment, store, log });

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

	markApp({ store, release, environment, state: 'pending', source });
	for (const { binding } of descriptor.databases) steps.migrate(binding);
	steps.deployWorker();
	const verified = await steps.verify();
	markApp({ store, release, environment, state: 'deployed', source });

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
