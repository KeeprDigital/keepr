import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { afterEach, describe, expect, it } from 'vitest';

const CLI = join(import.meta.dirname, '../scripts/deploy/cli.mjs');

/**
 * `keepr-deploy`, as `pnpm run deploy` and the Deploy workflow run it. An empty
 * PATH means any git, pnpm or wrangler it tried to spawn would fail to start,
 * so these show what it refuses before it touches anything.
 */
describe('the keepr-deploy command line', () => {
	const roots: string[] = [];

	afterEach(() => {
		for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
	});

	function run(args: string[], cwd = process.cwd()) {
		return spawnSync(process.execPath, [CLI, ...args], {
			cwd,
			env: { ...process.env, PATH: '', CLOUDFLARE_API_TOKEN: 'blocked-by-test-guard' },
			encoding: 'utf8',
		});
	}

	it.each([
		['an unknown command', ['bogus']],
		['a deploy naming no Environment', ['deploy', '--app', 'stream']],
		['a deploy naming no app', ['deploy', '--env', 'production']],
		[
			'an unknown mode',
			['deploy', '--app', 'stream', '--env', 'production', '--parts', 'sometimes'],
		],
		[
			'an unknown marker state',
			['mark-app', 'confirmed', '--app', 'stream', '--env', 'production'],
		],
		['an unknown option', ['status', '--app', 'stream', '--env', 'production', '--force']],
	])('refuses %s with its usage, exit 2', (_case, args) => {
		const result = run(args);

		expect(result.status).toBe(2);
		expect(result.stderr).toContain('usage: keepr-deploy');
	});

	function workspace(files: Record<string, string>) {
		const root = mkdtempSync(join(tmpdir(), 'keepr-cli-'));
		roots.push(root);
		for (const [path, content] of Object.entries(files)) {
			mkdirSync(dirname(join(root, path)), { recursive: true });
			writeFileSync(join(root, path), content);
		}
		return root;
	}

	// CI's Worker leg: a part that would not bundle fails it before the app's build starts.
	it('checks an app by bundling each part before its build, needing no Environment', () => {
		const root = workspace({
			'pnpm-workspace.yaml': 'packages: []\n',
			'apps/stream/package.json': JSON.stringify({ name: '@keepr/stream', version: '1.8.0' }),
			'apps/stream/deploy.jsonc': JSON.stringify({
				app: 'stream',
				build: ['build'],
				output: '.output',
				worker: { config: '.output/server/wrangler.json' },
				databases: [],
				environments: { production: { url: 'https://stream.keepr.digital' } },
				parts: { validator: { config: 'workers/validator/wrangler.jsonc' } },
			}),
		});

		const result = run(['check', '--app', 'stream'], root);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain('could not bundle workers/validator/wrangler.jsonc');
		expect(result.stderr).not.toContain('pnpm run build');
	});

	it('refuses a descriptor that would deploy the Accounts Stand-in before building anything', () => {
		const root = mkdtempSync(join(tmpdir(), 'keepr-cli-'));
		roots.push(root);
		const files = {
			'pnpm-workspace.yaml': 'packages: []\n',
			'packages/accounts-stand-in/package.json': JSON.stringify({
				name: '@keepr/accounts-stand-in',
				keepr: { undeployable: 'the Accounts Stand-in admits anyone.' },
			}),
			'apps/stream/package.json': JSON.stringify({ name: '@keepr/stream', version: '1.8.0' }),
			'apps/stream/deploy.jsonc': JSON.stringify({
				app: 'stream',
				build: ['build'],
				output: '.output',
				worker: { config: '../../packages/accounts-stand-in/stand-in.wrangler.jsonc' },
				databases: [],
				environments: { production: { url: 'https://stream.keepr.digital' } },
				parts: {},
			}),
		};
		for (const [path, content] of Object.entries(files)) {
			mkdirSync(dirname(join(root, path)), { recursive: true });
			writeFileSync(join(root, path), content);
		}

		const result = run(
			['deploy', '--app', 'stream', '--env', 'production'],
			join(root, 'apps/stream'),
		);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain('admits anyone');
		expect(result.stderr).not.toMatch(/spawn|ENOENT/);
	});
});
