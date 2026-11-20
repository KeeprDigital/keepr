import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { standInScan } from '../src/bundleScan.mjs';

// What keeps the stand-in out of an App's built Worker: a scan of the bundle,
// shown to find the stand-in in the one Wrangler really builds from it.

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const wrangler = join(
	dirname(createRequire(import.meta.url).resolve('wrangler/package.json')),
	'bin',
	'wrangler.js',
);

const directories: string[] = [];
function directory() {
	const made = mkdtempSync(join(tmpdir(), 'keepr-stand-in-scan-'));
	directories.push(made);
	return made;
}

afterEach(() => {
	for (const made of directories.splice(0)) rmSync(made, { recursive: true, force: true });
});

describe('the scan of a built Worker for the Accounts Stand-in', () => {
	it('finds the stand-in in the Worker Wrangler bundles from its configuration', () => {
		const out = directory();
		const built = spawnSync(
			process.execPath,
			[wrangler, 'deploy', '--dry-run', '--config', 'stand-in.wrangler.jsonc', '--outdir', out],
			{ cwd: packageRoot, encoding: 'utf8' },
		);
		expect({ status: built.status, stderr: built.stderr }).toMatchObject({ status: 0 });

		expect(standInScan(out)).toMatchObject({ ok: false });
	});

	it.each([
		['passes a bundle without it', { 'index.js': 'export default { fetch() {} };' }, true],
		['refuses a directory with nothing to scan', {}, false],
	])('%s', (_case, files, ok) => {
		const bundle = directory();
		for (const [name, text] of Object.entries(files)) writeFileSync(join(bundle, name), text);

		expect(standInScan(bundle).ok).toBe(ok);
	});
});
