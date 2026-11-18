/**
 * Each versioned app's CHANGELOG, and so its GitHub Release notes, grouped by
 * each changeset's bump, which already says what the operator and the reader
 * need (ADR-0127, amending ADR-0126):
 *
 *   ## <version>
 *   ### Operator steps   major: Deploy alone is not enough
 *   ### Features         minor: something a User or operator can newly do
 *   ### Fixes            patch whose PR is a fix
 *   ### Other changes    every other patch
 *
 * each entry `- **<scope>:** <the changeset's summary> (#<PR>)`. A heading
 * with no entry is left out.
 *
 * Two halves, because Changesets core groups a Release's lines under its own
 * `### Major/Minor/Patch Changes` and cannot be told otherwise:
 *
 * - **The changelog formatter** (`.changeset/config.json` `changelog`):
 *   Changesets calls `getReleaseLine` for each changeset with the commit that
 *   added it, on `main` the squash commit whose subject is the PR's
 *   Conventional Commit title. Its scope and PR number label the line, and a
 *   marker carries the bump and the type to the second half. A changeset with
 *   no commit, or a subject that is not Conventional, has no type, scope or PR.
 * - **The regroup** (`pnpm release:version`, after `changeset version`):
 *   rewrites the newest section of each versioned app's CHANGELOG.md into the
 *   sections above, leaving no marker and none of Changesets' headings. A
 *   section with no marker is left as it is, so a second run, an app with no
 *   new Release and every older section are unchanged.
 *
 *   node packages/tooling/scripts/changelog.mjs   (from the repository's root)
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { parseConventionalTitle } from './conventional-title.mjs';
import { ignoredPackages, versionedApps, workspacePackages } from './versioned-apps.mjs';

/** @typedef {'major' | 'minor' | 'patch'} Bump */
/**
 * What Changesets passes the formatter of each changeset (`@changesets/types`'
 * `NewChangesetWithCommit`), as far as it is read here.
 *
 * @typedef {{ summary: string, commit?: string | undefined }} Changeset
 */

const MARKER = /^- <!-- keepr-changelog (\w+) (\w+) -->/;
const COMMIT_ID = /^[0-9a-f]{7,40}$/;
const PR_SUFFIX = / \(#(\d+)\)$/;

/** @param {Bump} bump @param {string} type */
const marker = (bump, type) => `- <!-- keepr-changelog ${bump} ${type} -->`;

/**
 * The subject of a commit; null when there is none to read.
 *
 * @param {string | undefined} commit
 * @param {string} cwd
 */
function commitSubject(commit, cwd) {
	if (!commit || !COMMIT_ID.test(commit)) return null;
	try {
		return execFileSync('git', ['log', '-1', '--format=%s', commit], {
			cwd,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		}).trim();
	} catch {
		return null;
	}
}

/**
 * Changesets' changelog API: one changeset's line in its app's Release.
 *
 * @param {Changeset} changeset
 * @param {Bump} bump
 * @param {{ cwd?: string } | null} [options] `.changeset/config.json`'s, where the repository is (default: here)
 * @returns {string}
 */
export function getReleaseLine(changeset, bump, options) {
	const subject = commitSubject(changeset.commit, options?.cwd ?? process.cwd());
	const title = subject ? parseConventionalTitle(subject) : null;
	const pr = title ? PR_SUFFIX.exec(subject ?? '')?.[1] : undefined;

	const lines = changeset.summary
		.trim()
		.split('\n')
		.map((line) => line.trimEnd());
	const blank = lines.indexOf('');
	const firstParagraphEnd = (blank === -1 ? lines.length : blank) - 1;
	if (pr) lines[firstParagraphEnd] += ` (#${pr})`;
	if (title?.scope) lines[0] = `**${title.scope}:** ${lines[0]}`;

	const [first, ...rest] = lines;
	return [
		`${marker(bump, title?.type ?? 'none')}${first}`,
		...rest.map((line) => (line ? `  ${line}` : '')),
	].join('\n');
}

/**
 * Changesets' changelog API: the line for the apps a Release's app depends on.
 * Apps depend on no versioned app today.
 *
 * @param {unknown} _changesets
 * @param {{ name: string, newVersion: string }[]} dependencies
 * @returns {string}
 */
export function getDependencyReleaseLine(_changesets, dependencies) {
	if (dependencies.length === 0) return '';
	return `${marker('patch', 'none')}Updated dependencies: ${dependencies
		.map(({ name, newVersion }) => `${name}@${newVersion}`)
		.join(', ')}`;
}

const SECTIONS = /** @type {const} */ ([
	['Operator steps', (/** @type {string} */ bump) => bump === 'major'],
	['Features', (/** @type {string} */ bump) => bump === 'minor'],
	['Fixes', (/** @type {string} */ _bump, /** @type {string} */ type) => type === 'fix'],
	['Other changes', () => true],
]);

/**
 * A CHANGELOG with its newest Release's section regrouped; unchanged when that
 * section has no marker.
 *
 * @param {string} markdown a CHANGELOG.md
 * @returns {string}
 */
export function regroupNewestSection(markdown) {
	const lines = markdown.split('\n');
	const start = lines.findIndex((line) => line.startsWith('## '));
	if (start === -1) return markdown;
	const next = lines.findIndex((line, index) => index > start && line.startsWith('## '));
	const end = next === -1 ? lines.length : next;
	const body = lines.slice(start + 1, end);
	if (!body.some((line) => MARKER.test(line))) return markdown;

	/** @type {string[][]} */
	const entries = [];
	for (const line of body) {
		if (line.startsWith('- ')) entries.push([line]);
		else if (line.startsWith('### ')) entries.push([]);
		else entries.at(-1)?.push(line);
	}

	/** @type {string[][][]} */
	const grouped = SECTIONS.map(() => []);
	for (const entry of entries) {
		while (entry.length > 0 && entry.at(-1)?.trim() === '') entry.pop();
		if (entry.length === 0) continue;
		const [, bump = 'patch', type = 'none'] = MARKER.exec(entry[0] ?? '') ?? [];
		entry[0] = (entry[0] ?? '').replace(MARKER, '- ');
		grouped[SECTIONS.findIndex(([, belongs]) => belongs(bump, type))]?.push(entry);
	}

	const section = [lines[start] ?? ''];
	for (const [index, [heading]] of SECTIONS.entries()) {
		const sectionEntries = grouped[index] ?? [];
		if (sectionEntries.length === 0) continue;
		section.push('', `### ${heading}`, '', ...sectionEntries.flat());
	}
	const after = lines.slice(end);
	return [...lines.slice(0, start), ...section, ...(after.length > 0 ? ['', ...after] : [''])].join(
		'\n',
	);
}

/** @param {string} root the repository's root */
export function regroupChangelogs(root) {
	const regrouped = [];
	for (const app of versionedApps(workspacePackages(root), ignoredPackages(root))) {
		const path = join(root, app.dir, 'CHANGELOG.md');
		if (!existsSync(path)) continue;
		const before = readFileSync(path, 'utf8');
		const after = regroupNewestSection(before);
		if (after === before) continue;
		writeFileSync(path, after);
		regrouped.push(`${app.dir}/CHANGELOG.md`);
	}
	return regrouped;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)
	for (const path of regroupChangelogs(process.cwd())) console.log(`Regrouped ${path}`);
