import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { buildReleaseIdentity } from '../../../build/releaseIdentity';

// What a build bakes into the Worker for `/api/release`: the deploy tooling
// expects the app's name without `@keepr/`, its package version, and the commit.

const COMMIT = 'c'.repeat(40);
const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function app(manifest: Record<string, unknown>) {
	const root = mkdtempSync(join(tmpdir(), 'keepr-identity-'));
	roots.push(root);
	writeFileSync(join(root, 'package.json'), JSON.stringify(manifest));
	return root;
}

it.each([
	[
		'a versioned app at a commit',
		{ name: '@keepr/stream', version: '1.8.0' },
		() => `${COMMIT}\n`,
		{ app: 'stream', version: '1.8.0', commit: COMMIT },
	],
	[
		'an app Changesets does not version yet',
		{ name: '@keepr/accounts' },
		() => COMMIT,
		{ app: 'accounts', version: 'unversioned', commit: COMMIT },
	],
	[
		'a checkout git cannot read',
		{ name: '@keepr/score', version: '0.0.0' },
		() => {
			throw new Error('not a git repository');
		},
		{ app: 'score', version: '0.0.0', commit: 'unknown' },
	],
])('names %s', (_case, manifest, headCommit, identity) => {
	expect(buildReleaseIdentity({ rootDir: app(manifest), headCommit })).toEqual(identity);
});
