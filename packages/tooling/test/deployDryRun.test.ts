import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import process from 'node:process';
import { afterEach, describe, expect, it } from 'vitest';
import { dryRunEveryEnvironment } from '../scripts/deploy/dry-run.mjs';

const DESCRIPTOR = {
	output: '.output',
	worker: { config: '.output/server/wrangler.json' },
	environments: {
		production: { url: 'https://stream.keepr.digital' },
		staging: { url: 'https://stream.keepr-staging.digital', wranglerEnv: 'staging' },
	},
};

/**
 * An app directory whose Wrangler records each call and writes its bundle
 * where `--outdir` says, refusing the Environments in `refuses`.
 */
function app(refuses: string[] = []) {
	const appDir = mkdtempSync(join(tmpdir(), 'keepr-dry-run-'));
	mkdirSync(join(appDir, 'node_modules/.bin'), { recursive: true });
	const wrangler = join(appDir, 'node_modules/.bin/wrangler');
	writeFileSync(
		wrangler,
		`#!${process.execPath}
const { appendFileSync, mkdirSync, writeFileSync } = require('node:fs');
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(join(appDir, 'calls'))}, JSON.stringify(args) + '\\n');
const env = args.includes('--env') ? args[args.indexOf('--env') + 1] : 'top';
if (${JSON.stringify(refuses)}.includes(env)) process.exit(3);
const outDir = args[args.indexOf('--outdir') + 1];
mkdirSync(outDir, { recursive: true });
writeFileSync(outDir + '/index.js', 'bundle');
`,
	);
	chmodSync(wrangler, 0o755);
	const calls = () =>
		readFileSync(join(appDir, 'calls'), 'utf8')
			.split('\n')
			.filter(Boolean)
			.map((line) => JSON.parse(line) as string[]);
	return { appDir, wrangler, calls };
}

describe("the built Worker's dry run", () => {
	const dirs: string[] = [];
	afterEach(() => {
		for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	it('bundles for every Environment the descriptor names, each with its own Wrangler env', () => {
		const { appDir, wrangler, calls } = app();
		dirs.push(appDir);

		const bundles = dryRunEveryEnvironment({ appDir, descriptor: DESCRIPTOR, wrangler });

		expect(calls().map((args) => args.slice(0, 4).concat(args.slice(6)))).toEqual([
			['deploy', '--dry-run', '--config', '.output/server/wrangler.json'],
			['deploy', '--dry-run', '--config', '.output/server/wrangler.json', '--env', 'staging'],
		]);
		expect(Object.keys(bundles)).toEqual(['production', 'staging']);
	});

	// The output is the artifact every Environment deploys: a bundle left in it would ship.
	it('writes each bundle outside the output it was built from', () => {
		const { appDir, wrangler } = app();
		dirs.push(appDir);

		const bundles = dryRunEveryEnvironment({ appDir, descriptor: DESCRIPTOR, wrangler });

		for (const outDir of Object.values(bundles)) {
			expect(relative(join(appDir, DESCRIPTOR.output), outDir)).toMatch(/^\.\.\//);
			expect(readFileSync(join(outDir, 'index.js'), 'utf8')).toBe('bundle');
		}
	});

	it('fails naming the Environment whose configuration Wrangler refuses', () => {
		const { appDir, wrangler } = app(['staging']);
		dirs.push(appDir);

		expect(() => dryRunEveryEnvironment({ appDir, descriptor: DESCRIPTOR, wrangler })).toThrow(
			/staging/,
		);
	});
});
