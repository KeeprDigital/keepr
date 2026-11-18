import { describe, expect, it } from 'vitest';
import {
	deploymentMarkers,
	describeMarker,
	formatMarker,
	gitMarkerStore,
	markerName,
	parseMarker,
} from '../scripts/deploy/markers.mjs';
import { emptyGitHub, fakeGitHub } from './helpers/fakeGitHub.ts';

const FINGERPRINT_A = `sha256:${'a'.repeat(64)}`;
const COMMIT_A = '1'.repeat(40);

/** A marker as it reads, written out by hand. */
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
 * The markers before ADR-0133, annotated tags on the remote, read once as a
 * fallback. These cases hand the store a scripted stand-in for `git` and
 * check what it would run: no git process is spawned and no remote is reached.
 */
describe('the git marker store', () => {
	function fakeGit(answers: Record<string, string> = {}) {
		const calls: { args: string[] }[] = [];
		const git = (args: string[]) => {
			calls.push({ args });
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

	it('reads a lightweight tag as an empty, unreadable message', () => {
		const { git } = fakeGit({
			'ls-remote --tags origin refs/tags/production': `${'f'.repeat(40)}\trefs/tags/production\n`,
			'cat-file -t refs/tags/production': 'commit\n',
		});

		expect(gitMarkerStore({ git }).read('production')).toBe('');
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

/**
 * The markers are GitHub Deployments (ADR-0133): one environment per marker,
 * a deployment per attempt, its payload the marker's fields and its latest
 * status its state. These run against GitHub's Deployments API in memory.
 */
describe('the deployment marker store', () => {
	const NAME = 'stream/production-validator';

	function marker(state: 'pending' | 'deployed', commit = COMMIT_A, extra = {}) {
		return formatMarker({
			component: 'validator',
			state,
			commit,
			worktree: 'clean',
			fingerprint: FINGERPRINT_A,
			source: 'actions https://github.com/KeeprDigital/keepr/actions/runs/1',
			app: 'stream',
			environment: 'production',
			version: '1.9.0',
			...extra,
		});
	}

	it('records a deploy confirmed after its pending write as one deployment, read back deployed', () => {
		const github = fakeGitHub();
		const store = deploymentMarkers({ request: github.request });

		store.write(NAME, COMMIT_A, marker('pending'));
		store.write(NAME, COMMIT_A, marker('deployed'));

		expect(store.read(NAME)).toBe(marker('deployed'));
		expect(github.history(NAME)).toEqual([
			{
				sha: COMMIT_A,
				payload: expect.objectContaining({ fingerprint: FINGERPRINT_A, version: '1.9.0' }),
				statuses: ['in_progress', 'success'],
			},
		]);
	});

	const COMMIT_B = '2'.repeat(40);
	type Write = [state: 'pending' | 'deployed', commit: string, extra?: Record<string, string>];

	// README § Recovering from a partial promotion: what an operator reads after each history.
	it.each<[string, Write[], 'pending' | 'deployed', string, number]>([
		['a deploy that died after its pending write', [['pending', COMMIT_A]], 'pending', COMMIT_A, 1],
		[
			'a deploy of B that died over a confirmed A',
			[
				['pending', COMMIT_A],
				['deployed', COMMIT_A],
				['pending', COMMIT_B],
			],
			'pending',
			COMMIT_B,
			2,
		],
		[
			'a confirmation that records other fields than its pending write (mark-app by hand)',
			[
				['pending', COMMIT_B],
				['deployed', COMMIT_B, { override: 'Keepr Accounts is down' }],
			],
			'deployed',
			COMMIT_B,
			2,
		],
		[
			'a confirmation at another commit than the pending write',
			[
				['pending', COMMIT_A],
				['deployed', COMMIT_B],
			],
			'deployed',
			COMMIT_B,
			2,
		],
		[
			'a confirmation with no pending write before it',
			[['deployed', COMMIT_A]],
			'deployed',
			COMMIT_A,
			1,
		],
	])('%s', (_case, writes, state, commit, deployments) => {
		const github = fakeGitHub();
		const store = deploymentMarkers({ request: github.request });

		for (const [written, at, extra] of writes) store.write(NAME, at, marker(written, at, extra));

		expect(parseMarker(store.read(NAME) ?? '')).toMatchObject({ state, commit });
		expect(github.history(NAME)).toHaveLength(deployments);
	});

	it.each(['failure', 'error', 'inactive'])(
		'reads a deployment whose latest status is %s as pending: it confirms nothing',
		(status) => {
			const github = fakeGitHub();
			const store = deploymentMarkers({ request: github.request });
			store.write(NAME, COMMIT_A, marker('deployed'));

			github.request('POST', 'deployments/1/statuses', { state: status });

			expect(parseMarker(store.read(NAME) ?? '')).toMatchObject({ state: 'pending' });
		},
	);

	it('reads a deployment whose payload is not a marker as unreadable', () => {
		const github = fakeGitHub();
		github.request('POST', 'deployments', { ref: COMMIT_A, environment: NAME, payload: {} });

		expect(deploymentMarkers({ request: github.request }).read(NAME)).toBe('');
	});

	// The first deploy after ADR-0133 decides its parts on the tags it replaces.
	it('reads the tag marker until the marker has a deployment, then the deployment alone', () => {
		const github = fakeGitHub();
		const tags = {
			read: (name: string) => (name === NAME ? deployedMarker(FINGERPRINT_A) : undefined),
			names: () => [NAME],
		};
		const store = deploymentMarkers({ request: github.request, fallback: tags });

		const before = store.read(NAME);
		store.write(NAME, COMMIT_B, marker('pending', COMMIT_B));

		expect(before).toBe(deployedMarker(FINGERPRINT_A));
		expect(parseMarker(store.read(NAME) ?? '')).toMatchObject({
			state: 'pending',
			commit: COMMIT_B,
		});
		expect(store.read('stream/production')).toBeUndefined();
	});

	it('names every marker once, whether a deployment or only a tag records it', () => {
		const github = fakeGitHub({
			...emptyGitHub(),
			environments: [
				'production',
				...Array.from(
					{ length: 100 },
					(_, n) => `app${String.fromCharCode(97 + (n % 26))}/staging${n}`,
				),
				'stream/production',
			],
		});
		const tags = {
			read: () => undefined,
			names: () => ['@keepr/stream@1.9.0', 'stream/production', 'stream/staging'],
		};

		const names = deploymentMarkers({ request: github.request, fallback: tags }).names();

		expect(names).toHaveLength(104);
		expect(names.filter((name) => name.startsWith('stream/')).toSorted()).toEqual([
			'stream/production',
			'stream/staging',
		]);
	});

	// A deploy that cannot write its pending marker never starts.
	it("refuses a marker at a commit GitHub lacks, as a local deploy's unpushed one", () => {
		const github = fakeGitHub(emptyGitHub([COMMIT_A]));

		expect(() =>
			deploymentMarkers({ request: github.request }).write(
				NAME,
				COMMIT_B,
				marker('pending', COMMIT_B),
			),
		).toThrow(/No ref found/);
	});
});
