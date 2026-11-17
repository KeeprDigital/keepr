import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fingerprintPart } from '../scripts/deploy/fingerprint.mjs';

/**
 * A part's fingerprint is what `wrangler deploy` would upload (the bundle), what
 * it would build the Container image from (its Docker context), and the Worker
 * configuration resolved for the target Environment. These cases stand a
 * fixture checkout in for an app and a fixed bundle in for wrangler. Wrangler is
 * never run here: a real bundle's stability (no absolute or temporary paths in
 * the module) was measured by hand, and an unstable one would only redeploy.
 */
describe("fingerprinting a part (Stream Keepr's silent-video validator)", () => {
	const roots: string[] = [];

	afterEach(() => {
		for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
	});

	const CONFIG = 'workers/silent-video-validator/wrangler.jsonc';
	const part = { config: CONFIG, container: 'workers/silent-video-validator/container' };

	function checkout(config = '{ "name": "stream-silent-video-validator" }\n') {
		const root = mkdtempSync(join(tmpdir(), 'keepr-part-'));
		roots.push(root);
		const files: Record<string, string> = {
			'package.json': '{ "version": "1.0.0" }\n',
			[CONFIG]: config,
			'workers/silent-video-validator/container/Dockerfile':
				'FROM node:22\nCOPY server.mjs ./server.mjs\n',
			'workers/silent-video-validator/container/server.mjs': 'console.log(1);\n',
		};
		for (const [path, content] of Object.entries(files)) {
			mkdirSync(dirname(join(root, path)), { recursive: true });
			writeFileSync(join(root, path), content);
		}
		return root;
	}

	/** A bundler writing what wrangler writes: the module, its source map, a timestamped README. */
	function bundler(moduleSource: string) {
		return ({ outDir }: { outDir: string }) => {
			writeFileSync(join(outDir, 'index.js'), moduleSource);
			writeFileSync(join(outDir, 'index.js.map'), `{"sourceRoot":"${outDir}"}`);
			writeFileSync(
				join(outDir, 'README.md'),
				`generated at ${new Date().toISOString()}${Math.random()}`,
			);
		};
	}

	const bundle = bundler('// node_modules/@cloudflare/containers@0.3.7\nexport default {};\n');
	const fingerprint = (appDir: string, options: { wranglerEnv?: string } = {}) =>
		fingerprintPart({ appDir, part, bundle, ...options });

	it("is the same for the same inputs in different checkouts, ignoring source maps and wrangler's README", () => {
		const first = fingerprint(checkout());

		expect(first).toMatch(/^sha256:[0-9a-f]{64}$/);
		expect(fingerprint(checkout())).toBe(first);
	});

	it('changes on a dependency-only change: the part folder is untouched but the bundle differs', () => {
		const root = checkout();
		const before = fingerprint(root);
		const after = fingerprintPart({
			appDir: root,
			part,
			bundle: bundler('// node_modules/@cloudflare/containers@0.3.8\nexport default {};\n'),
		});

		expect(after).not.toBe(before);
	});

	it.each([
		['the Dockerfile', 'workers/silent-video-validator/container/Dockerfile'],
		[
			"a file in the Container's Docker context",
			'workers/silent-video-validator/container/server.mjs',
		],
	])('changes when %s changes, though the bundle does not', (_case, path) => {
		const root = checkout();
		const before = fingerprint(root);
		writeFileSync(join(root, path), '# changed\n', { flag: 'a' });

		expect(fingerprint(root)).not.toBe(before);
	});

	it("changes when a file is added to the Container's Docker context", () => {
		const root = checkout();
		const before = fingerprint(root);
		writeFileSync(join(root, 'workers/silent-video-validator/container/extra.mjs'), '');

		expect(fingerprint(root)).not.toBe(before);
	});

	it("does not change on a release's version bump, which leaves the bundle alone", () => {
		const root = checkout();
		const before = fingerprint(root);
		writeFileSync(join(root, 'package.json'), '{ "version": "1.1.0" }\n');

		expect(fingerprint(root)).toBe(before);
	});

	// The configuration is hashed as wrangler resolves it for the Environment:
	// what another Environment's block says, or how the file is laid out, is not
	// something this Environment's Worker is built from.
	describe('by Environment', () => {
		const BASE = '{ "name": "stream-silent-video-validator", "vars": { "LIMIT": "1" } }';
		const WITH_STAGING = (limit: string) =>
			`{ "name": "stream-silent-video-validator", "vars": { "LIMIT": "1" },
			   "env": { "staging": { "vars": { "LIMIT": "${limit}" } } } }`;

		it.each([
			[
				'a staging-only edit leaves production unchanged',
				WITH_STAGING('2'),
				WITH_STAGING('3'),
				undefined,
				'same',
			],
			[
				'a staging-only edit changes staging',
				WITH_STAGING('2'),
				WITH_STAGING('3'),
				'staging',
				'differs',
			],
			[
				'an edit every Environment inherits changes production',
				BASE,
				BASE.replace('"1"', '"2"'),
				undefined,
				'differs',
			],
			[
				'comments and layout change nothing',
				BASE,
				`// the validator\n{\n\t"vars": { "LIMIT": "1", },\n\t"name": "stream-silent-video-validator",\n}\n`,
				undefined,
				'same',
			],
		] as const)('%s', (_case, before, after, wranglerEnv, expected) => {
			const options = wranglerEnv === undefined ? {} : { wranglerEnv };
			const first = fingerprint(checkout(before), options);
			const second = fingerprint(checkout(after), options);

			if (expected === 'same') expect(second).toBe(first);
			else expect(second).not.toBe(first);
		});

		it('refuses an Environment the configuration has no block for', () => {
			expect(() => fingerprint(checkout(BASE), { wranglerEnv: 'staging' })).toThrow(/staging/);
		});

		it('bundles for the Environment it fingerprints', () => {
			const asked: (string | undefined)[] = [];
			fingerprintPart({
				appDir: checkout(WITH_STAGING('2')),
				part,
				wranglerEnv: 'staging',
				bundle: (options: { outDir: string; wranglerEnv?: string }) => {
					asked.push(options.wranglerEnv);
					bundle(options);
				},
			});

			expect(asked).toEqual(['staging']);
		});
	});

	it('fails rather than fingerprinting a bundle that could not be built', () => {
		const failing = () => {
			throw new Error('could not bundle the validator: boom');
		};

		expect(() => fingerprintPart({ appDir: checkout(), part, bundle: failing })).toThrow(/boom/);
	});
});
