import { describe, expect, it } from 'vitest';
import {
	describeMarker,
	formatMarker,
	gitMarkerStore,
	markerName,
	parseMarker,
} from '../scripts/deploy/markers.mjs';

const FINGERPRINT_A = `sha256:${'a'.repeat(64)}`;
const COMMIT_A = '1'.repeat(40);

/** A marker as an annotated tag's message carries it, written out by hand. */
function deployedMarker(fingerprint: string, commit = COMMIT_A) {
	return [
		'stream-keepr promotion marker',
		'',
		'component: validator',
		'state: deployed',
		`commit: ${commit}`,
		'worktree: clean',
		`fingerprint: ${fingerprint}`,
		'source: local',
		'app: stream',
		'environment: production',
		'',
	].join('\n');
}

describe("a marker's name", () => {
	it.each([
		['an app in an Environment', ['stream', 'production'], 'stream/production'],
		['a part of it', ['stream', 'production', 'validator'], 'stream/production-validator'],
		['another app', ['accounts', 'staging'], 'accounts/staging'],
	] as const)('%s', (_case, [app, environment, part], name) => {
		expect(markerName(app, environment, part)).toBe(name);
	});

	// A slash or dash inside a segment would make two markers' names collide.
	it.each([
		['an app with a slash', ['stream/x', 'production']],
		['an Environment with a dash', ['stream', 'pre-production']],
		['an empty part', ['stream', 'production', '']],
	] as const)('refuses %s', (_case, [app, environment, part]) => {
		expect(() => markerName(app, environment, part)).toThrow(/marker/);
	});
});

describe("a marker's message", () => {
	it('reads back the fields it was written with, the app and Environment among them', () => {
		const fields = {
			component: 'app',
			state: 'deployed',
			commit: COMMIT_A,
			worktree: 'clean',
			source: 'local',
			app: 'stream',
			environment: 'production',
			version: '1.8.0',
		};

		expect(parseMarker(formatMarker(fields))).toEqual(fields);
	});

	it('reads a marker written before the app and Environment fields, as ADR-0035 wrote them', () => {
		expect(
			parseMarker(deployedMarker(FINGERPRINT_A).replace(/app: .*\nenvironment: .*\n/, '')),
		).toEqual(expect.objectContaining({ component: 'validator', fingerprint: FINGERPRINT_A }));
	});

	it.each([
		['an empty message (a lightweight tag)', ''],
		['a message without the marker header', 'Release v1.4.0\n'],
		[
			'a garbled field line',
			deployedMarker(FINGERPRINT_A).replace('state: deployed', 'state deployed'),
		],
	])('is unreadable for %s', (_case, text) => {
		expect(parseMarker(text)).toBeUndefined();
	});

	it('refuses a field name a reader could not read back', () => {
		expect(() => formatMarker({ deployed_by: 'local' })).toThrow(/deployed_by/);
	});

	// An override's reason is written by hand; a reader takes one line per field.
	it.each([
		['spans lines', 'Keepr Accounts is down\nsee #1300'],
		['is empty', ''],
		['is only spaces', '   '],
	])('refuses a value that %s', (_case, override) => {
		expect(() => formatMarker({ component: 'app', override })).toThrow(/override/);
	});
});

/**
 * The markers are annotated tags on the remote. These cases hand the store a
 * scripted stand-in for `git` and check what it would run: no git process is
 * spawned and no remote is reached.
 */
describe('the git marker store', () => {
	function fakeGit(answers: Record<string, string> = {}) {
		const calls: { args: string[]; input?: string }[] = [];
		const git = (args: string[], options: { input?: string } = {}) => {
			calls.push({
				args,
				...(options.input === undefined ? {} : { input: options.input }),
			});
			return answers[args.join(' ')] ?? '';
		};
		return { git, calls };
	}

	const NAME = 'stream/production-validator';
	const REF = `refs/tags/${NAME}`;

	it('reads a missing marker as undefined without fetching it', () => {
		// As git does: fetching a ref the remote does not have fails.
		const git = (args: string[]) => {
			if (args[0] === 'fetch') throw new Error(`fatal: couldn't find remote ref ${REF}`);
			return '';
		};

		expect(gitMarkerStore({ git }).read(NAME)).toBeUndefined();
	});

	it("reads the remote's marker, replacing any stale local copy of the tag", () => {
		const message = deployedMarker(FINGERPRINT_A);
		const { git, calls } = fakeGit({
			[`ls-remote --tags origin ${REF}`]: `${'f'.repeat(40)}\t${REF}\n`,
			[`cat-file -t ${REF}`]: 'tag\n',
			[`for-each-ref --format=%(contents) ${REF}`]: message,
		});

		expect(gitMarkerStore({ git }).read(NAME)).toBe(message);
		expect(calls.map((call) => call.args)).toContainEqual([
			'fetch',
			'--no-tags',
			'origin',
			`+${REF}:${REF}`,
		]);
	});

	it('reads a lightweight tag (the pre-#616 production tag) as an empty, unreadable message', () => {
		const { git } = fakeGit({
			'ls-remote --tags origin refs/tags/production': `${'f'.repeat(40)}\trefs/tags/production\n`,
			'cat-file -t refs/tags/production': 'commit\n',
		});

		expect(gitMarkerStore({ git }).read('production')).toBe('');
	});

	it('writes an annotated tag on the commit and force-pushes that one tag only', () => {
		const { git, calls } = fakeGit();
		const message = deployedMarker(FINGERPRINT_A);

		gitMarkerStore({ git }).write(NAME, COMMIT_A, message);

		expect(calls).toEqual([
			{ args: ['tag', '--force', '--annotate', '--file=-', NAME, COMMIT_A], input: message },
			{ args: ['push', 'origin', `+${REF}:${REF}`] },
		]);
	});

	it('removes a marker from the remote, and only when the remote has it', () => {
		const present = fakeGit({
			'ls-remote --tags origin refs/tags/production': `${'f'.repeat(40)}\trefs/tags/production\n`,
		});
		const absent = fakeGit();

		gitMarkerStore({ git: present.git }).remove('production');
		gitMarkerStore({ git: absent.git }).remove('production');

		expect(present.calls.map((call) => call.args)).toContainEqual([
			'push',
			'origin',
			':refs/tags/production',
		]);
		expect(absent.calls.map((call) => call.args[0])).not.toContain('push');
	});

	it("names every tag on the remote once, whether or not it is a marker, from the remote's own list", () => {
		const sha = 'f'.repeat(40);
		const { git } = fakeGit({
			'ls-remote --tags origin': [
				`${sha}\trefs/tags/@keepr/stream@1.7.0`,
				`${sha}\trefs/tags/stream/production`,
				`${sha}\trefs/tags/stream/production^{}`,
				`${sha}\trefs/tags/accounts/production`,
				'',
			].join('\n'),
		});

		expect(gitMarkerStore({ git }).names()).toEqual([
			'@keepr/stream@1.7.0',
			'stream/production',
			'accounts/production',
		]);
	});

	it('describes the checkout: its HEAD commit, and dirty when anything is uncommitted or untracked', () => {
		const clean = fakeGit({ 'rev-parse HEAD': `${COMMIT_A}\n` });
		const dirty = fakeGit({ 'status --porcelain --untracked-files=all': '?? stray.ts\n' });

		expect(gitMarkerStore({ git: clean.git }).head()).toBe(COMMIT_A);
		expect(gitMarkerStore({ git: clean.git }).dirty()).toBe(false);
		expect(gitMarkerStore({ git: dirty.git }).dirty()).toBe(true);
	});
});

// What `deploy:status` and a stopped deploy print: the state an operator
// recovers from, and the commit it is about.
describe('describing a marker', () => {
	it.each([
		['a missing marker', undefined, ['missing']],
		['a lightweight tag', '', ['unreadable']],
		['a confirmed deploy', deployedMarker(FINGERPRINT_A), ['deployed', COMMIT_A]],
		[
			'an unconfirmed one',
			deployedMarker(FINGERPRINT_A).replace('state: deployed', 'state: pending'),
			['pending', COMMIT_A],
		],
	])('%s', (_case, text, tokens) => {
		const description = describeMarker(text);

		for (const token of tokens) expect(description).toContain(token);
	});

	it('never prints undefined for a field the marker lacks', () => {
		expect(describeMarker('stream-keepr promotion marker\n\ncomponent: validator\n')).not.toContain(
			'undefined',
		);
	});
});
