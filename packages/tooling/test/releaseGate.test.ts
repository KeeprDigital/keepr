import { describe, expect, it } from 'vitest';
import { checkRelease, pendingTags } from '../scripts/release-gate.mjs';

const RELEASE_COMMIT = 'c'.repeat(40);

interface Run {
	event: string;
	path: string;
	head_sha: string;
	conclusion: string | null;
}

function ciRun(overrides: Partial<Run> = {}): Run {
	return {
		event: 'merge_group',
		path: '.github/workflows/ci.yml',
		head_sha: RELEASE_COMMIT,
		conclusion: 'success',
		...overrides,
	};
}

function runsFor(runs: Run[]) {
	return async (sha: string) => runs.filter((run) => run.head_sha === sha);
}

const release = { tags: ['@keepr/stream@1.7.0'], commit: RELEASE_COMMIT };
const REFUSED = `@keepr/stream@1.7.0 would tag ${RELEASE_COMMIT}, which no successful merge-queue CI run verified.`;

const stream = { name: '@keepr/stream', dir: 'apps/stream', version: '1.7.0', dependencies: {} };
const accounts = {
	name: '@keepr/accounts',
	dir: 'apps/accounts',
	version: '0.1.0',
	dependencies: {},
};

describe('what a release would tag', () => {
	it.each<[string, string[], string[]]>([
		[
			'every app already tagged at its version: nothing',
			['@keepr/stream@1.7.0', '@keepr/accounts@0.1.0'],
			[],
		],
		[
			'an app whose version has no tag yet',
			['@keepr/stream@1.6.0', '@keepr/accounts@0.1.0'],
			['@keepr/stream@1.7.0'],
		],
		[
			'a v* tag of the same version is not its tag',
			['v1.7.0', '@keepr/accounts@0.1.0'],
			['@keepr/stream@1.7.0'],
		],
	])('%s', (_case, tags, pending) => {
		expect(pendingTags([accounts, stream], new Set(tags))).toEqual(pending);
	});
});

describe('a release is cut only from a revision the merge queue verified', () => {
	it('no tag to create: nothing to release, nothing to refuse', async () => {
		await expect(checkRelease({ tags: [], commit: RELEASE_COMMIT }, runsFor([]))).resolves.toEqual(
			[],
		);
	});

	it('tags a commit that passed CI as a merge group', async () => {
		await expect(
			checkRelease(
				release,
				runsFor([ciRun({ event: 'pull_request', conclusion: 'failure' }), ciRun()]),
			),
		).resolves.toEqual([]);
	});

	it.each<[string, Run[]]>([
		['it landed outside the queue: no merge-group run tested it', []],
		['only its PR runs passed, which tested a different tree', [ciRun({ event: 'pull_request' })]],
		['its merge-group run failed', [ciRun({ conclusion: 'failure' })]],
		['its merge-group run was cancelled', [ciRun({ conclusion: 'cancelled' })]],
		[
			"the passing merge-group run is another workflow's",
			[ciRun({ path: '.github/workflows/pr-title.yml' })],
		],
		[
			'the passing merge-group run tested another commit',
			[
				ciRun({
					head_sha: 'd'.repeat(40),
				}),
			],
		],
	])('refuses when %s', async (_case, runs) => {
		await expect(checkRelease(release, runsFor(runs))).resolves.toEqual([REFUSED]);
	});

	it('waits for a merge-group run still finishing: the queue merges on the check, a moment before the run concludes', async () => {
		const answers = [[ciRun({ conclusion: null })], [ciRun({ conclusion: null })], [ciRun()]];
		const waits: number[] = [];
		const wait = async (ms: number) => {
			waits.push(ms);
		};

		await expect(
			checkRelease(release, async () => answers.shift()!, { attempts: 5, wait }),
		).resolves.toEqual([]);
		expect(waits).toHaveLength(2);
	});

	it('gives up on a merge-group run that never concludes', async () => {
		let asked = 0;
		const unfinished = async () => {
			asked += 1;
			return [ciRun({ conclusion: null })];
		};

		await expect(
			checkRelease(release, unfinished, {
				attempts: 3,
				wait: async () => {},
			}),
		).resolves.toEqual([REFUSED]);
		expect(asked).toBe(3);
	});

	it('does not wait when no merge-group run is still going', async () => {
		let asked = 0;
		const failed = async () => {
			asked += 1;
			return [ciRun({ conclusion: 'failure' })];
		};

		await checkRelease(release, failed, {
			attempts: 3,
			wait: async () => {},
		});
		expect(asked).toBe(1);
	});

	it('names every tag it refuses', async () => {
		await expect(
			checkRelease(
				{ tags: ['@keepr/accounts@0.1.0', '@keepr/stream@1.7.0'], commit: RELEASE_COMMIT },
				runsFor([]),
			),
		).resolves.toEqual([
			`@keepr/accounts@0.1.0, @keepr/stream@1.7.0 would tag ${RELEASE_COMMIT}, which no successful merge-queue CI run verified.`,
		]);
	});
});
