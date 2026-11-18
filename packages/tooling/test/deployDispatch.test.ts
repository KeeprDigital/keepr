import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { afterEach, describe, expect, it } from 'vitest';
import { releasedTags } from '../scripts/deploy/dispatch.mjs';

const DISPATCH = join(import.meta.dirname, '../scripts/deploy/dispatch.mjs');

/** What changesets/action answers as `published-packages` once it made the GitHub Releases. */
const PUBLISHED = JSON.stringify([
	{ name: '@keepr/stream', version: '1.9.0' },
	{ name: '@keepr/accounts', version: '0.3.0' },
]);

describe('the Releases a release run deploys', () => {
	it.each([
		['each app released, as its tag', PUBLISHED, ['@keepr/stream@1.9.0', '@keepr/accounts@0.3.0']],
		['nothing, when nothing was released', '[]', []],
		['nothing, when the action answered nothing', '', []],
	])('are %s', (_, published, tags) => {
		expect(releasedTags(published)).toEqual(tags);
	});

	// Only an app's Release deploys; anything else stops the dispatch, loudly.
	it.each([
		['a package that is no app', [{ name: 'left-pad', version: '1.0.0' }]],
		['a version with a space', [{ name: '@keepr/stream', version: '1.9.0 --ref x' }]],
		['no version', [{ name: '@keepr/stream' }]],
	])('refuses %s', (_, published) => {
		expect(() => releasedTags(JSON.stringify(published))).toThrow(/not an app's Release/);
	});
});

/**
 * The release workflow's dispatch step: a fake `gh`, alone on PATH, records
 * what it was asked.
 */
describe("the release workflow's dispatch", () => {
	const roots: string[] = [];

	afterEach(() => {
		for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
	});

	function run(published: string) {
		const root = mkdtempSync(join(tmpdir(), 'keepr-dispatch-'));
		roots.push(root);
		const asked = join(root, 'asked');
		writeFileSync(join(root, 'gh'), `#!/bin/sh\nprintf '%s\\n' "$@" > '${asked}'\n`);
		chmodSync(join(root, 'gh'), 0o755);
		const result = spawnSync(process.execPath, [DISPATCH], {
			env: {
				PATH: root,
				GITHUB_REPOSITORY: 'keepr/keepr',
				GH_TOKEN: 'test-token',
				PUBLISHED_PACKAGES: published,
			},
			encoding: 'utf8',
		});
		return { result, asked: existsSync(asked) ? readFileSync(asked, 'utf8').split('\n') : [] };
	}

	it('starts one Deploy run from main, of every app released, to staging and then production', () => {
		const { result, asked } = run(PUBLISHED);

		expect(result.status, result.stdout).toBe(0);
		expect(asked).toEqual([
			'workflow',
			'run',
			'deploy.yml',
			'--repo',
			'keepr/keepr',
			'--ref',
			'main',
			'-f',
			'releases=@keepr/stream@1.9.0 @keepr/accounts@0.3.0',
			'-f',
			'environment=staging then production',
			'',
		]);
	});

	it('starts none when nothing was released', () => {
		const { result, asked } = run('[]');

		expect(result.status).toBe(0);
		expect(asked).toEqual([]);
	});
});
