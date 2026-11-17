/**
 * Promotion markers (ADR-0035, ADR-0119): one annotated tag on `origin` per app,
 * Environment and part, named `<app>/<environment>[-<part>]` (`stream/production`,
 * `stream/production-validator`). Its message records the component, its state,
 * the commit it was deployed from, whether that checkout was dirty, a part's
 * fingerprint, who deployed it, the app, the Environment and the Release's
 * version.
 *
 * The format is append-only: a field keeps its meaning, a new one is added at
 * the end, and the header line is the one ADR-0035 wrote, so a reader of any
 * age reads every marker.
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
 * The markers each app × Environment had before ADR-0119 named them per app,
 * by the name that replaces them. A deploy removes one once its replacement
 * records a confirmed deploy.
 */
export const LEGACY_MARKERS = new Map([
	['stream/production', 'production'],
	['stream/production-validator', 'production-validator'],
]);

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
	for (const name of Object.keys(fields))
		if (!FIELD_NAME.test(name))
			throw new Error(`marker field ${JSON.stringify(name)} would not read back: use [a-z]+.`);
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
 * deployed; `read` answers a marker tag's message on the remote (undefined
 * when the tag does not exist); `write` points the tag at a commit with that
 * message on the remote; `remove` deletes it there.
 *
 * @typedef {{
 *   head: () => string,
 *   dirty: () => boolean,
 *   read: (name: string) => string | undefined,
 *   write: (name: string, commit: string, message: string) => void,
 *   remove: (name: string) => void,
 * }} MarkerStore
 */

/** @param {string} cwd */
function runGit(cwd) {
	/** @param {string[]} args @param {{ input?: string }} [options] */
	return (args, { input } = {}) => {
		const result = spawnSync('git', args, { cwd, encoding: 'utf8', input });
		if (result.status !== 0)
			throw new Error(
				`git ${args.join(' ')} failed: ${result.error?.message ?? result.stderr.trim()}`,
			);
		return result.stdout;
	};
}

/**
 * The markers as annotated tags on `remote`, read and written through `git`
 * in the checkout being deployed. A read always fetches the remote's tag, so a
 * stale local copy never answers; a lightweight tag (the pre-#616 `production`
 * tag) reads as an empty message. A write force-pushes that one tag.
 *
 * @param {{
 *   cwd?: string,
 *   remote?: string,
 *   git?: (args: string[], options?: { input?: string }) => string,
 * }} options
 * @returns {MarkerStore} the store
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
		write(name, commit, message) {
			git(['tag', '--force', '--annotate', '--file=-', name, commit], { input: message });
			git(['push', remote, `+${ref(name)}:${ref(name)}`]);
		},
		remove(name) {
			if (onRemote(name)) git(['push', remote, `:${ref(name)}`]);
		},
	};
}

/**
 * One line saying what a marker records.
 *
 * @param {string | undefined} text the marker tag's message, undefined when it does not exist
 */
export function describeMarker(text) {
	if (text === undefined) return 'missing';
	const marker = parseMarker(text);
	if (!marker)
		return 'unreadable (not a promotion marker; a pre-#616 lightweight tag reads this way)';
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
