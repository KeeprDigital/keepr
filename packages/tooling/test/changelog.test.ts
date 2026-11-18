import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	getDependencyReleaseLine,
	getReleaseLine,
	regroupNewestSection,
} from '../scripts/changelog.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const CHANGELOG_MODULE = resolve(here, '../scripts/changelog.mjs');
const CHANGESET_BIN = resolve(here, '../../../node_modules/.bin/changeset');

const gitEnv = {
	...process.env,
	GIT_AUTHOR_NAME: 'Test',
	GIT_AUTHOR_EMAIL: 'test@example.com',
	GIT_COMMITTER_NAME: 'Test',
	GIT_COMMITTER_EMAIL: 'test@example.com',
	GIT_CONFIG_NOSYSTEM: '1',
	GIT_CONFIG_GLOBAL: '/dev/null',
};
const git = (cwd: string, ...args: string[]) =>
	execFileSync('git', args, { cwd, encoding: 'utf8', env: gitEnv }).trim();

type Bump = 'major' | 'minor' | 'patch';

const FEAT = 'feat(stream): gates target one Environment (#1276)';
const FIX = 'fix(cards): keep a resolved card (#1300)';
const BUILD = 'build(stream): a Staging Installation configuration (#1277)';
const CI = 'ci: a merge group reuses a PR run (#1274)';
const NO_PR = 'feat(stream): landed around the queue';
const NOT_CONVENTIONAL = 'Merge branch main';

/** `main`'s history: one squash commit per subject, each adding a changeset. */
let repo: string;
const commits = new Map<string, string>();

beforeAll(() => {
	repo = mkdtempSync(join(tmpdir(), 'changelog-'));
	git(repo, 'init', '-q', '-b', 'main');
	for (const [index, subject] of [FEAT, FIX, BUILD, CI, NO_PR, NOT_CONVENTIONAL].entries()) {
		writeFileSync(join(repo, `changeset-${index}.md`), 'What changed.\n');
		git(repo, 'add', '-A');
		git(repo, 'commit', '-q', '-m', subject);
		commits.set(subject, git(repo, 'rev-parse', 'HEAD'));
	}
});

afterAll(() => rmSync(repo, { recursive: true, force: true }));

interface Entry {
	bump: Bump;
	summary: string;
	/** The subject of the commit that added it; none when uncommitted, or a sha. */
	subject?: string;
	commit?: string;
}

const line = ({ bump, summary, subject, commit }: Entry) =>
	getReleaseLine({ summary, commit: commit ?? (subject && commits.get(subject)) }, bump, {
		cwd: repo,
	});

/** A Release's section as Changesets core lays its lines out. */
function changesetsSection(version: string, entries: Entry[], extra: string[] = []) {
	const headings = (['major', 'minor', 'patch'] as const)
		.map((bump) => {
			const lines = entries.filter((entry) => entry.bump === bump).map(line);
			if (bump === 'patch') lines.push(...extra);
			const heading = `${bump[0]!.toUpperCase()}${bump.slice(1)} Changes`;
			return lines.length > 0 ? `### ${heading}\n\n${lines.join('\n')}` : '';
		})
		.filter(Boolean);
	return [`## ${version}`, ...headings].join('\n\n');
}

const OLDER = `## 1.8.0

### Minor Changes

- b731ea9: Deploys run through the workspace's deploy tooling.

  A local deploy reads \`KEEPR_DEPLOY_URL\`.

## [1.6.0](https://github.com/KeeprDigital/keepr/compare/v1.5.0...v1.6.0) (2026-11-17)


### Features

* **api:** a stopgap public read ([#861](https://github.com/KeeprDigital/keepr/issues/861))
`;

const changelog = (newest: string) => `# Changelog\n\n${newest}\n\n${OLDER}`;

/** The newest section, as the regroup leaves it. */
const regrouped = (entries: Entry[], extra?: string[]) => {
	const after = regroupNewestSection(changelog(changesetsSection('1.9.0', entries, extra)));
	expect(after.endsWith(`\n\n${OLDER}`)).toBe(true);
	return after.slice('# Changelog\n\n'.length, -`\n\n${OLDER}`.length);
};

describe("a changeset's entry, from the squash commit that added it", () => {
	it.each<[string, Entry, string]>([
		[
			'a minor, whatever its type: Features, with its scope and PR',
			{ bump: 'minor', summary: 'Staging is configured.', subject: BUILD },
			'### Features\n\n- **stream:** Staging is configured. (#1277)',
		],
		[
			'a patch fix: Fixes',
			{ bump: 'patch', summary: 'A resolved card is kept.', subject: FIX },
			'### Fixes\n\n- **cards:** A resolved card is kept. (#1300)',
		],
		[
			'a patch of any other type, feat included: Other changes',
			{ bump: 'patch', summary: 'Gates target one Environment.', subject: FEAT },
			'### Other changes\n\n- **stream:** Gates target one Environment. (#1276)',
		],
		[
			'a major, whatever its type: Operator steps',
			{ bump: 'major', summary: 'Set `NEW_SECRET` before deploying.', subject: FEAT },
			'### Operator steps\n\n- **stream:** Set `NEW_SECRET` before deploying. (#1276)',
		],
		[
			'no scope: no scope',
			{ bump: 'patch', summary: 'Runs are reused.', subject: CI },
			'### Other changes\n\n- Runs are reused. (#1274)',
		],
		[
			'no PR in the subject: no PR',
			{ bump: 'minor', summary: 'Landed.', subject: NO_PR },
			'### Features\n\n- **stream:** Landed.',
		],
		[
			'a subject that is not Conventional: Other changes, no scope, no PR',
			{ bump: 'patch', summary: 'Merged.', subject: NOT_CONVENTIONAL },
			'### Other changes\n\n- Merged.',
		],
		[
			'not yet committed: Other changes, no scope, no PR',
			{ bump: 'patch', summary: 'Uncommitted.' },
			'### Other changes\n\n- Uncommitted.',
		],
		[
			'a commit git cannot read: Other changes, no scope, no PR',
			{ bump: 'patch', summary: 'Unreadable.', commit: 'f'.repeat(40) },
			'### Other changes\n\n- Unreadable.',
		],
		[
			'several paragraphs: the PR ends the first, the rest stay in the entry',
			{
				bump: 'minor',
				summary:
					'Deploys run through the tooling,\nwhich reads a descriptor.\n\nA local deploy reads `KEEPR_DEPLOY_URL`.\n',
				subject: FEAT,
			},
			'### Features\n\n- **stream:** Deploys run through the tooling,\n  which reads a descriptor. (#1276)\n\n  A local deploy reads `KEEPR_DEPLOY_URL`.',
		],
	])('%s', (_case, entry, section) => {
		expect(regrouped([entry])).toBe(`## 1.9.0\n\n${section}`);
	});

	it("an app a Release's app depends on: Other changes", () => {
		const dependencies = getDependencyReleaseLine(
			[],
			[{ name: '@keepr/accounts', newVersion: '0.2.0' }],
		);

		expect(getDependencyReleaseLine([], [])).toBe('');
		expect(regrouped([], [dependencies])).toBe(
			'## 1.9.0\n\n### Other changes\n\n- Updated dependencies: @keepr/accounts@0.2.0',
		);
	});
});

describe("a Release's section", () => {
	const RELEASE: Entry[] = [
		{ bump: 'major', summary: 'Wipe the database.', subject: BUILD },
		{ bump: 'minor', summary: 'Staging is configured.', subject: BUILD },
		{ bump: 'minor', summary: 'Gates target one Environment.', subject: FEAT },
		{ bump: 'patch', summary: 'Runs are reused.', subject: CI },
		{ bump: 'patch', summary: 'A resolved card is kept.', subject: FIX },
	];

	it('groups Operator steps, Features, Fixes and Other changes, in that order, and none of the bumps', () => {
		expect(regrouped(RELEASE)).toBe(`## 1.9.0

### Operator steps

- **stream:** Wipe the database. (#1277)

### Features

- **stream:** Staging is configured. (#1277)
- **stream:** Gates target one Environment. (#1276)

### Fixes

- **cards:** A resolved card is kept. (#1300)

### Other changes

- Runs are reused. (#1274)`);
	});

	it('leaves out a heading with no entry', () => {
		expect(regrouped([RELEASE[3]!, RELEASE[2]!])).toBe(`## 1.9.0

### Features

- **stream:** Gates target one Environment. (#1276)

### Other changes

- Runs are reused. (#1274)`);
	});

	// A second run, or an app `changeset version` gave no new Release, is left
	// as it is; so is every older section, whatever its format.
	it.each([
		['regrouped already', regroupNewestSection(changelog(changesetsSection('1.9.0', RELEASE)))],
		['in no format of this one', `# Changelog\n\n${OLDER}`],
	])('leaves a CHANGELOG whose newest section is %s unchanged', (_case, markdown) => {
		expect(regroupNewestSection(markdown)).toBe(markdown);
	});

	it('is the end of the CHANGELOG when it is its only section', () => {
		const first = `# @keepr/accounts\n\n${changesetsSection('0.1.0', [RELEASE[2]!])}\n`;

		expect(regroupNewestSection(first)).toBe(
			'# @keepr/accounts\n\n## 0.1.0\n\n### Features\n\n- **stream:** Gates target one Environment. (#1276)\n',
		);
	});
});

// One pass through Changesets itself: what it hands the formatter, and the
// layout the regroup reads.
describe('pnpm release:version', () => {
	let workspace: string;

	beforeAll(() => {
		workspace = mkdtempSync(join(tmpdir(), 'changelog-version-'));
		const write = (path: string, text: string) => {
			mkdirSync(dirname(join(workspace, path)), { recursive: true });
			writeFileSync(join(workspace, path), text);
		};
		write('package.json', JSON.stringify({ name: 'keepr', private: true }));
		write('pnpm-workspace.yaml', 'packages:\n  - apps/*\n');
		write(
			'.changeset/config.json',
			JSON.stringify({
				baseBranch: 'main',
				changelog: CHANGELOG_MODULE,
				commit: false,
				ignore: ['@keepr/score'],
				privatePackages: { version: true, tag: true },
			}),
		);
		write(
			'apps/stream/package.json',
			JSON.stringify({ name: '@keepr/stream', version: '1.8.0', private: true }),
		);
		write('apps/stream/CHANGELOG.md', `# Changelog\n\n${OLDER}`);
		write(
			'apps/score/package.json',
			JSON.stringify({ name: '@keepr/score', version: '0.0.0', private: true }),
		);
		git(workspace, 'init', '-q', '-b', 'main');
		git(workspace, 'add', '-A');
		git(workspace, 'commit', '-q', '-m', 'chore: the workspace');
		write(
			'.changeset/gates.md',
			"---\n'@keepr/stream': patch\n---\n\nGates target one Environment.\n",
		);
		git(workspace, 'add', '-A');
		git(workspace, 'commit', '-q', '-m', FEAT);
		write('.changeset/staging.md', "---\n'@keepr/stream': minor\n---\n\nStaging is configured.\n");
		git(workspace, 'add', '-A');
		git(workspace, 'commit', '-q', '-m', BUILD);

		execFileSync(CHANGESET_BIN, ['version'], { cwd: workspace, env: gitEnv, stdio: 'ignore' });
		execFileSync(process.execPath, [CHANGELOG_MODULE], { cwd: workspace, stdio: 'ignore' });
	});

	afterAll(() => rmSync(workspace, { recursive: true, force: true }));

	it("writes each versioned app's new Release grouped by bump, above its older ones", () => {
		expect(readFileSync(join(workspace, 'apps/stream/CHANGELOG.md'), 'utf8')).toBe(`# Changelog

## 1.9.0

### Features

- **stream:** Staging is configured. (#1277)

### Other changes

- **stream:** Gates target one Environment. (#1276)

${OLDER}`);
	});
});
