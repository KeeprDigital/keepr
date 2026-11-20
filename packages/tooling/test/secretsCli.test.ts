import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import process from 'node:process';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeCheckout } from './helpers/secretsFakes.ts';

/**
 * `pnpm secrets:sync` as a person runs it: the arguments it takes, where it
 * finds the checkout, and what it exits with. What a sync does is
 * `secretsSync.test.ts`'s; `op`, `wrangler` and `gh` are the same fakes.
 */
const CLI = join(import.meta.dirname, '../scripts/secrets/cli.mjs');

const DESCRIPTOR = {
	app: 'stream',
	build: [],
	output: '.output',
	worker: {
		source: 'wrangler.jsonc',
		config: '.output/server/wrangler.json',
		name: 'stream',
		secrets: ['AUTH_SECRET', 'ISSUED_KEY'],
	},
	databases: [],
	environments: {
		staging: { url: 'https://stream-staging.example', wranglerEnv: 'staging' },
	},
	parts: {},
};

const SECRETS_MAP = {
	workers: {
		stream: {
			environments: {
				staging: {
					AUTH_SECRET: 'op://Keepr/stream-staging/AUTH_SECRET',
					ISSUED_KEY: 'op://Keepr/stream-staging/ISSUED_KEY',
				},
			},
			generate: { AUTH_SECRET: { warn: 'a new AUTH_SECRET signs every User out' } },
		},
	},
	github: { staging: { CLOUDFLARE_API_TOKEN: 'op://Keepr/github-staging/CLOUDFLARE_API_TOKEN' } },
};

describe('the pnpm secrets:sync command line', () => {
	const checkouts: { remove: () => void }[] = [];
	afterEach(() => {
		for (const checkout of checkouts.splice(0)) checkout.remove();
	});

	function setUp({ signedOutWrangler = false } = {}) {
		const checkout = fakeCheckout({
			descriptor: DESCRIPTOR,
			wranglerConfig: { env: { staging: { name: 'stream' } } },
			secretsMap: SECRETS_MAP,
			state: {
				vaults: {
					Keepr: {
						'stream-staging': { AUTH_SECRET: 'auth-value-1', ISSUED_KEY: '' },
						'github-staging': { CLOUDFLARE_API_TOKEN: 'cf-value-2' },
					},
				},
				workers: {},
				github: { staging: {} },
				...(signedOutWrangler ? { signedOut: { wrangler: true } } : {}),
			},
		});
		checkouts.push(checkout);
		const run = (args: string[], cwd = checkout.root) =>
			spawnSync(process.execPath, [CLI, ...args], {
				cwd,
				env: { ...process.env, ...checkout.env },
				encoding: 'utf8',
			});
		return { ...checkout, run };
	}

	it.each([
		['no target', []],
		['an app without an Environment', ['--app', 'stream']],
		['an Environment without an app', ['--env', 'staging']],
		[
			'an Installation and a GitHub environment at once',
			['--app', 'stream', '--env', 'staging', '--github', 'staging'],
		],
		['an Environment beside a GitHub environment', ['--github', 'staging', '--env', 'staging']],
		['an unknown option', ['--github', 'staging', '--force']],
		['--generate with no name', ['--app', 'stream', '--env', 'staging', '--generate']],
	])('refuses %s with its usage, exit 2, touching nothing', (_case, args) => {
		const { run, state } = setUp();

		const result = run(args);

		expect(result.status).toBe(2);
		expect(result.stderr).toContain('usage: pnpm secrets:sync');
		expect(state().argv).toEqual([]);
	});

	it.each([
		['a sync that set everything', ['--github', 'staging'], 0],
		['a check that finds a gap', ['--app', 'stream', '--env', 'staging', '--check'], 1],
		['a refusal', ['--app', 'stream', '--env', 'staging', '--generate', 'ISSUED_KEY'], 1],
	])('exits as %s does, from anywhere in the checkout', (_case, args, status) => {
		const { root, run } = setUp();

		expect(run(args, join(root, 'apps/stream')).status).toBe(status);
	});

	it('passes each --generate it is given', () => {
		const { run, state } = setUp();

		const result = run([
			'--app',
			'stream',
			'--env',
			'staging',
			'--generate',
			'AUTH_SECRET',
			'--generate',
			'ISSUED_KEY',
		]);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain('ISSUED_KEY is issued by its provider');
		expect(state().vaults.Keepr!['stream-staging']!.AUTH_SECRET).toBe('auth-value-1');
	});

	it('prints why a sync failed on stderr, exit 1, with no value in it', () => {
		const { run } = setUp({ signedOutWrangler: true });

		const result = run(['--app', 'stream', '--env', 'staging']);

		expect(result.status).toBe(1);
		expect(result.stderr).toMatch(/wrangler secret bulk failed: .*Not logged in/);
		expect(result.stderr).not.toContain('auth-value-1');
	});

	it('refuses outside a pnpm workspace', () => {
		const { run } = setUp();

		const result = run(['--github', 'staging'], '/');

		expect(result.status).toBe(1);
		expect(result.stderr).toContain('is not inside a pnpm workspace');
	});
});
