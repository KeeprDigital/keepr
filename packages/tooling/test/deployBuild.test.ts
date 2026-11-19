import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildCommands, STAND_IN_LAUNCHER } from '../scripts/deploy/build.mjs';

// A Worker that binds Keepr Accounts asks it who each request belongs to, and a
// build smokes the built Worker with no Keepr Accounts beside it: so its build
// scripts run beside the Accounts Stand-in (ADR-0113), for a deploy and CI alike.

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const BINDING = { binding: 'KEEPR_ACCOUNTS', service: 'keepr-accounts' };

/** A Release checkout of one app whose source Wrangler configuration is `wrangler`. */
function release(wrangler: unknown | undefined, { standIn = true } = {}) {
	const root = mkdtempSync(join(tmpdir(), 'keepr-build-'));
	roots.push(root);
	const write = (path: string, content: string) => {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), content);
	};
	if (wrangler !== undefined) write('apps/stream/wrangler.jsonc', JSON.stringify(wrangler));
	if (standIn) write(STAND_IN_LAUNCHER, '');
	return {
		root,
		release: {
			appDir: join(root, 'apps/stream'),
			descriptor: {
				app: 'stream',
				build: ['build', 'worker:smoke'],
				output: '.output',
				worker: { source: 'wrangler.jsonc', config: '.output/server/wrangler.json' },
				databases: [],
				environments: { production: { url: 'https://stream.keepr.digital' } },
				parts: {},
			},
		},
	};
}

const plain = [
	{ command: 'pnpm', args: ['run', 'build'] },
	{ command: 'pnpm', args: ['run', 'worker:smoke'] },
];

describe("a Release's build scripts", () => {
	it.each([
		['binds only other services', { services: [{ binding: 'OTHER', service: 'other' }] }],
		['has no source configuration to read', undefined],
	])('run as they are when the app %s', (_case, wrangler) => {
		expect(buildCommands(release(wrangler).release, { node: 'node' })).toEqual(plain);
	});

	it.each([
		['at its top level', { services: [BINDING] }],
		// A Wrangler `env` block inherits no binding, so one Environment's alone counts.
		['in one Environment only', { env: { staging: { services: [BINDING] } } }],
	])(
		"each run beside the Release's own Accounts Stand-in when the app binds Keepr Accounts %s",
		(_case, wrangler) => {
			const { root, release: bound } = release(wrangler);
			const launcher = join(root, STAND_IN_LAUNCHER);

			expect(buildCommands(bound, { node: 'node' })).toEqual([
				{ command: 'node', args: [launcher, '--', 'pnpm', 'run', 'build'] },
				{ command: 'node', args: [launcher, '--', 'pnpm', 'run', 'worker:smoke'] },
			]);
		},
	);

	it('are refused when the app binds Keepr Accounts in a checkout with no stand-in', () => {
		const { release: bound } = release({ services: [BINDING] }, { standIn: false });

		expect(() => buildCommands(bound)).toThrow(
			/stream binds Keepr Accounts, and this checkout has no Accounts Stand-in/,
		);
	});
});
