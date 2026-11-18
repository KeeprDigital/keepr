/**
 * Promotion markers (ADR-0035, ADR-0119, ADR-0133): one per app, Environment
 * and part, named `<app>/<environment>[-<part>]` (`stream/production`,
 * `stream/production-validator`), each a GitHub Deployments environment of
 * that name. A marker records what it marks (`component`: `app` or the part),
 * its state, the commit it was deployed from, whether that checkout was
 * dirty, a part's fingerprint, who deployed it, the app, the Environment and
 * the Release's version.
 *
 * Until ADR-0133 each marker was an annotated tag on `origin` of the same
 * name. A marker no deployment records yet is read from its tag, once, so
 * the first deploy after it keeps its decisions; nothing writes a tag.
 *
 * A marker reads as text, as the tag's message was: the format is
 * append-only, a field keeps its meaning, a new one is added at the end, and
 * the header line is the one ADR-0035 wrote, so a reader of any age reads
 * every marker.
 */

import { spawnSync } from 'node:child_process';
import process from 'node:process';

export const MARKER_HEADER = 'stream-keepr promotion marker';

/** A field name a reader reads back: `parseMarker` takes `[a-z]+` and nothing else. */
const FIELD_NAME = /^[a-z]+$/;
/** An app, Environment or part: lowercase letters, and in an app's name a dash between words. */
const APP = /^[a-z]+(?:-[a-z]+)*$/;
const SEGMENT = /^[a-z]+$/;

/**
 * The marker of an app in an Environment, or of one of its parts.
 *
 * @param {string} app
 * @param {string} environment
 * @param {string} [part]
 */
export function markerName(app, environment, part) {
	if (!APP.test(app) || !SEGMENT.test(environment) || (part !== undefined && !SEGMENT.test(part)))
		throw new Error(
			`no promotion marker can be named for app ${JSON.stringify(app)}, Environment ${JSON.stringify(environment)}${
				part === undefined ? '' : `, part ${JSON.stringify(part)}`
			}: each is lowercase letters (an app's name may join words with a dash).`,
		);
	return `${app}/${environment}${part === undefined ? '' : `-${part}`}`;
}

/**
 * A marker's message: the header, then one `name: value` line per field.
 *
 * @param {Record<string, string>} fields
 */
export function formatMarker(fields) {
	for (const [name, value] of Object.entries(fields)) {
		if (!FIELD_NAME.test(name))
			throw new Error(`marker field ${JSON.stringify(name)} would not read back: use [a-z]+.`);
		if (value === '' || value.trim() !== value || /[\r\n]/.test(value))
			throw new Error(
				`marker field ${name}'s value ${JSON.stringify(value)} would not read back: use one line of text, not blank, without surrounding spaces.`,
			);
	}
	return [
		MARKER_HEADER,
		'',
		...Object.entries(fields).map(([name, value]) => `${name}: ${value}`),
		'',
	].join('\n');
}

/**
 * Read a marker's message. Anything without the header line, or with a field
 * line that is not `name: value`, is unreadable (`undefined`).
 *
 * @param {string} text
 * @returns {Record<string, string> | undefined} its fields, or undefined when unreadable
 */
export function parseMarker(text) {
	const lines = text
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
	if (lines[0] !== MARKER_HEADER) return undefined;
	/** @type {Record<string, string>} */
	const fields = {};
	for (const line of lines.slice(1)) {
		const match = /^([a-z]+): (.+)$/.exec(line);
		if (!match) return undefined;
		fields[match[1]] = match[2];
	}
	return fields;
}

/**
 * Where the markers live. `head` and `dirty` describe the checkout being
 * deployed; `read` answers a marker's text (undefined when nothing records
 * it); `write` records one at a commit; `names` lists every name a marker may
 * have, markers among them.
 *
 * @typedef {{
 *   head: () => string,
 *   dirty: () => boolean,
 *   read: (name: string) => string | undefined,
 *   write: (name: string, commit: string, message: string) => void,
 *   names: () => string[],
 * }} MarkerStore
 */

/** @param {string} cwd */
function runGit(cwd) {
	/** @param {string[]} args */
	return (args) => {
		const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
		if (result.status !== 0)
			throw new Error(
				`git ${args.join(' ')} failed: ${result.error?.message ?? result.stderr.trim()}`,
			);
		return result.stdout;
	};
}

/**
 * The checkout being deployed, and the markers it had before ADR-0133 as
 * annotated tags on `remote`, read through `git`: the one-time fallback
 * `deploymentMarkers` reads. A read always fetches the remote's tag, so a
 * stale local copy never answers; a lightweight tag reads as an empty
 * message.
 *
 * @param {{
 *   cwd?: string,
 *   remote?: string,
 *   git?: (args: string[]) => string,
 * }} options
 * @returns {Omit<MarkerStore, 'write'>} the checkout and the tags
 */
export function gitMarkerStore({ cwd = process.cwd(), remote = 'origin', git = runGit(cwd) } = {}) {
	/** @param {string} name */
	const ref = (name) => `refs/tags/${name}`;
	/** @param {string} name */
	const onRemote = (name) => git(['ls-remote', '--tags', remote, ref(name)]).trim() !== '';
	return {
		head: () => git(['rev-parse', 'HEAD']).trim(),
		dirty: () => git(['status', '--porcelain', '--untracked-files=all']).trim() !== '',
		read(name) {
			if (!onRemote(name)) return undefined;
			git(['fetch', '--no-tags', remote, `+${ref(name)}:${ref(name)}`]);
			if (git(['cat-file', '-t', ref(name)]).trim() !== 'tag') return '';
			return git(['for-each-ref', '--format=%(contents)', ref(name)]);
		},
		names() {
			const names = git(['ls-remote', '--tags', remote])
				.split('\n')
				.map((line) => line.split('\t')[1])
				.filter((name) => name?.startsWith('refs/tags/') && !name.endsWith('^{}'))
				.map((name) => name.slice('refs/tags/'.length));
			return [...new Set(names)];
		},
	};
}

/**
 * GitHub's REST API through `gh api`, for the repository `gh` resolves in
 * `cwd` (its `origin`, or `GH_REPO`), as `gh` is signed in: the operator's
 * login locally, `GH_TOKEN` in the Deploy workflow.
 *
 * @param {{ cwd?: string }} [options]
 * @returns {GitHubRequest}
 */
export function ghRequest({ cwd = process.cwd() } = {}) {
	return (method, path, body) => {
		const args = ['api', '--method', method, `repos/{owner}/{repo}/${path}`];
		if (body !== undefined) args.push('--input', '-');
		const result = spawnSync('gh', args, {
			cwd,
			encoding: 'utf8',
			...(body === undefined ? {} : { input: JSON.stringify(body) }),
		});
		if (result.status !== 0)
			throw new Error(
				`gh api --method ${method} ${path} failed: ${result.error?.message ?? result.stderr.trim()}`,
			);
		return result.stdout.trim() === '' ? undefined : JSON.parse(result.stdout);
	};
}

/**
 * The markers of the checkout at `cwd`: GitHub Deployments, falling back to
 * the tags they replace, with the checkout's HEAD and state.
 *
 * @param {{ cwd?: string }} [options]
 * @returns {MarkerStore}
 */
export function markerStore({ cwd = process.cwd() } = {}) {
	const checkout = gitMarkerStore({ cwd });
	return {
		head: checkout.head,
		dirty: checkout.dirty,
		...deploymentMarkers({ request: ghRequest({ cwd }), fallback: checkout }),
	};
}

/**
 * One request to GitHub's REST API for this repository: `path` is under
 * `repos/{owner}/{repo}/`. It answers the parsed JSON, and throws when GitHub
 * refuses.
 *
 * @typedef {(method: 'GET' | 'POST', path: string, body?: object) => any} GitHubRequest
 */

/**
 * The latest deployment in a marker's environment, and its latest status.
 *
 * @param {GitHubRequest} request
 * @param {string} name
 */
function latestDeployment(request, name) {
	const [deployment] = request(
		'GET',
		`deployments?environment=${encodeURIComponent(name)}&per_page=1`,
	);
	if (!deployment) return undefined;
	const [status] = request('GET', `deployments/${deployment.id}/statuses?per_page=1`);
	return { deployment, state: status?.state };
}

/**
 * A deployment's payload as the marker's text, in `state`; empty, so
 * unreadable, for a deployment made some other way.
 *
 * @param {unknown} payload
 * @param {string} state
 */
function markerText(payload, state) {
	// Every marker records what it marks.
	if (typeof payload !== 'object' || typeof (/** @type {any} */ (payload)?.component) !== 'string')
		return '';
	try {
		return formatMarker({ .../** @type {Record<string, string>} */ (payload), state });
	} catch {
		return '';
	}
}

/**
 * The markers as GitHub Deployments (ADR-0133): each marker is an environment
 * of its name, each attempt a deployment at the commit it deploys, whose
 * payload holds the marker's fields and whose latest status is its state:
 * `in_progress` while it is pending, `success` once it is deployed. Any other
 * status (`failure`, `error`, `inactive`) confirms nothing, so it reads as
 * pending. A `deployed` write confirms the pending attempt it follows, when
 * that attempt recorded the same fields at the same commit, and is an attempt
 * of its own otherwise.
 *
 * A marker with no deployment yet reads from `fallback`, the tag it replaces,
 * so the first deploy after ADR-0133 keeps its decisions.
 *
 * @param {{
 *   request: GitHubRequest,
 *   fallback?: Pick<MarkerStore, 'read' | 'names'>,
 * }} options
 * @returns {Pick<MarkerStore, 'read' | 'write' | 'names'>}
 */
export function deploymentMarkers({ request, fallback }) {
	return {
		read(name) {
			const latest = latestDeployment(request, name);
			if (!latest) return fallback?.read(name);
			return markerText(
				latest.deployment.payload,
				latest.state === 'success' ? 'deployed' : 'pending',
			);
		},
		write(name, commit, message) {
			const fields = parseMarker(message);
			if (!fields?.state)
				throw new Error(`the ${name} marker would not read back: it records no state.`);
			const status = fields.state === 'deployed' ? 'success' : 'in_progress';
			const latest = latestDeployment(request, name);
			const confirms =
				status === 'success' &&
				latest !== undefined &&
				latest.state === 'in_progress' &&
				latest.deployment.sha === commit &&
				markerText(latest.deployment.payload, 'deployed') === message;
			const { id } = confirms
				? latest.deployment
				: request('POST', 'deployments', {
						ref: commit,
						environment: name,
						payload: fields,
						auto_merge: false,
						required_contexts: [],
						transient_environment: false,
						production_environment: false,
						description:
							`${fields.app ?? ''} ${fields.version ?? ''} ${fields.component ?? ''}`.trim(),
					});
			const run = /^actions (https:\S+)$/.exec(fields.source ?? '')?.[1];
			request('POST', `deployments/${id}/statuses`, {
				state: status,
				...(run ? { log_url: run } : {}),
			});
		},
		names() {
			/** @type {string[]} */
			const names = [];
			for (let page = 1; ; page++) {
				const { environments } = request('GET', `environments?per_page=100&page=${page}`);
				names.push(...environments.map((/** @type {{ name: string }} */ { name }) => name));
				if (environments.length < 100) break;
			}
			return [...new Set([...names, ...(fallback?.names() ?? [])])];
		},
	};
}

/**
 * One line saying what a marker records.
 *
 * @param {string | undefined} text the marker as it reads, undefined when nothing records it
 */
export function describeMarker(text) {
	if (text === undefined) return 'missing';
	const marker = parseMarker(text);
	if (!marker)
		return 'unreadable (not a promotion marker: a lightweight tag, or a deployment made some other way)';
	const details = [
		marker.version && `version ${marker.version}`,
		marker.fingerprint && `fingerprint ${marker.fingerprint}`,
		marker.worktree && `${marker.worktree} worktree`,
		marker.source && `from ${marker.source}`,
	].filter(Boolean);
	const state =
		marker.state === 'pending'
			? 'pending (started, never confirmed)'
			: (marker.state ?? '(no state)');
	return `${state} ${marker.commit ?? '(no commit)'}${
		details.length ? ` (${details.join(', ')})` : ''
	}`;
}
