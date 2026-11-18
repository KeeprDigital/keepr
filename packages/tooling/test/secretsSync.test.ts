import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import process from 'node:process';
import { afterEach, describe, expect, it } from 'vitest';
import { syncSecrets } from '../scripts/secrets/sync.mjs';
import { type FakeState, fakeCheckout } from './helpers/secretsFakes.ts';

const DESCRIPTOR = {
	app: 'stream',
	build: [],
	output: '.output',
	worker: {
		source: 'wrangler.jsonc',
		config: '.output/server/wrangler.json',
		// The build names production's Worker; staging's env block names it itself.
		name: 'stream',
		secrets: ['AUTH_SECRET', 'SCREEN_KEY', 'MELEE_KEY', 'ABLY_KEY'],
	},
	databases: [],
	environments: {
		production: { url: 'https://stream.example' },
		staging: { url: 'https://stream-staging.example', wranglerEnv: 'staging' },
	},
	parts: {},
};

const WRANGLER_CONFIG = { env: { staging: { name: 'stream' } } };

const references = (item: string, names: string[]) =>
	Object.fromEntries(names.map((name) => [name, `op://Keepr/${item}/${name}`]));

const SECRETS_MAP = {
	workers: {
		stream: {
			environments: {
				staging: references('stream-staging', [...DESCRIPTOR.worker.secrets, 'CARD_KEY']),
				production: references('stream-production', [...DESCRIPTOR.worker.secrets, 'CARD_KEY']),
			},
			optional: ['CARD_KEY'],
			generate: {
				AUTH_SECRET: { warn: 'a new AUTH_SECRET signs every User out' },
				SCREEN_KEY: { warn: 'a new SCREEN_KEY revokes Screen access' },
				MELEE_KEY: { refuse: 'a new Melee key needs its version var bumped' },
			},
		},
	},
	github: {
		staging: references('github-staging', ['CLOUDFLARE_API_TOKEN', 'OPERATOR_PASSWORD']),
	},
};

/** Values no output, argument or error may ever show. */
const VALUES = {
	AUTH_SECRET: 'auth-value-1',
	SCREEN_KEY: 'screen-value-2',
	ABLY_KEY: 'ably-value-3',
	CLOUDFLARE_API_TOKEN: 'cf-value-4',
	OPERATOR_PASSWORD: 'multi\nline-value-5',
};

const VAULTS: FakeState['vaults'] = {
	Keepr: {
		'stream-staging': {
			AUTH_SECRET: VALUES.AUTH_SECRET,
			SCREEN_KEY: VALUES.SCREEN_KEY,
			MELEE_KEY: '',
			ABLY_KEY: VALUES.ABLY_KEY,
			CARD_KEY: '',
		},
		'stream-production': {
			AUTH_SECRET: VALUES.AUTH_SECRET,
			SCREEN_KEY: VALUES.SCREEN_KEY,
			MELEE_KEY: '',
			ABLY_KEY: VALUES.ABLY_KEY,
			CARD_KEY: '',
		},
		'github-staging': {
			CLOUDFLARE_API_TOKEN: VALUES.CLOUDFLARE_API_TOKEN,
			OPERATOR_PASSWORD: VALUES.OPERATOR_PASSWORD,
		},
	},
};

describe('pnpm secrets:sync', () => {
	const checkouts: { remove: () => void }[] = [];
	afterEach(() => {
		for (const checkout of checkouts.splice(0)) checkout.remove();
	});

	function setUp(state: Partial<Omit<FakeState, 'argv'>> = {}) {
		const checkout = fakeCheckout({
			descriptor: DESCRIPTOR,
			wranglerConfig: WRANGLER_CONFIG,
			secretsMap: SECRETS_MAP,
			state: { vaults: structuredClone(VAULTS), workers: {}, github: { staging: {} }, ...state },
		});
		checkouts.push(checkout);
		const lines: string[] = [];
		const sync = (options: Omit<Parameters<typeof syncSecrets>[0], 'root' | 'env' | 'log'>) =>
			syncSecrets({
				root: checkout.root,
				env: checkout.env,
				log: (line: string) => lines.push(line),
				...options,
			});
		return { ...checkout, lines, sync };
	}

	describe("an Installation's Worker", () => {
		it.each([
			['staging, whose env block names the Worker', 'staging'],
			['production, named by the descriptor where its config leaves it to the build', 'production'],
		])(
			'in %s gets every secret 1Password records, and each unrecorded one is named',
			(_case, environment) => {
				const { sync, state, lines } = setUp();

				const result = sync({ target: { app: 'stream', environment } });

				expect(state().workers).toEqual({
					stream: {
						AUTH_SECRET: VALUES.AUTH_SECRET,
						SCREEN_KEY: VALUES.SCREEN_KEY,
						ABLY_KEY: VALUES.ABLY_KEY,
					},
				});
				expect(lines.join('\n')).toMatch(/Not recorded in 1Password.*MELEE_KEY/);
				expect(lines.join('\n')).toMatch(/CARD_KEY \(optional\)/);
				// A required secret 1Password lacks leaves the Installation's record incomplete.
				expect(result.ok).toBe(false);
			},
		);
	});

	describe('--check', () => {
		it('names what the Worker lacks, what 1Password lacks and what the map does not know, and sets nothing', () => {
			const { sync, state, lines } = setUp({
				workers: { stream: { AUTH_SECRET: 'old', ADMIN_BOOTSTRAP_TOKEN: 'old' } },
			});

			const result = sync({ target: { app: 'stream', environment: 'staging' }, check: true });

			expect(state().workers).toEqual({
				stream: { AUTH_SECRET: 'old', ADMIN_BOOTSTRAP_TOKEN: 'old' },
			});
			const said = lines.join('\n');
			expect(said).toMatch(
				/Missing on Worker stream.*: SCREEN_KEY at .*, MELEE_KEY at .*, ABLY_KEY at .*, CARD_KEY \(optional\)/,
			);
			expect(said).toMatch(/Not recorded in 1Password.*MELEE_KEY/);
			expect(said).toMatch(/not in the secrets map: ADMIN_BOOTSTRAP_TOKEN/);
			expect(result.ok).toBe(false);
		});

		it.each([
			['every required secret set and recorded', { MELEE_KEY: 'recorded' }, true],
			['a required secret 1Password lacks, though the Worker has it', {}, false],
		])('passes only with %s', (_case, recorded, ok) => {
			const vaults = structuredClone(VAULTS);
			Object.assign(vaults.Keepr!['stream-staging']!, recorded);
			const { sync } = setUp({
				vaults,
				workers: { stream: { AUTH_SECRET: 'a', SCREEN_KEY: 'b', MELEE_KEY: 'c', ABLY_KEY: 'd' } },
			});

			expect(sync({ target: { app: 'stream', environment: 'staging' }, check: true }).ok).toBe(ok);
		});

		it('says a Worker that does not exist yet lacks every secret', () => {
			const { sync, lines } = setUp();

			const result = sync({ target: { app: 'stream', environment: 'production' }, check: true });

			expect(lines.join('\n')).toMatch(/does not exist yet[^]*Missing on .*AUTH_SECRET/);
			expect(result.ok).toBe(false);
		});
	});

	describe('a GitHub environment', () => {
		it('gets every secret 1Password records, each value whole', () => {
			const { sync, state } = setUp();

			const result = sync({ target: { github: 'staging' } });

			expect(state().github.staging).toEqual({
				CLOUDFLARE_API_TOKEN: VALUES.CLOUDFLARE_API_TOKEN,
				OPERATOR_PASSWORD: VALUES.OPERATOR_PASSWORD,
			});
			expect(result.ok).toBe(true);
		});

		it('with --check, names what it lacks and sets nothing', () => {
			const { sync, lines, state } = setUp({ github: { staging: { CLOUDFLARE_API_TOKEN: 'x' } } });

			const result = sync({ target: { github: 'staging' }, check: true });

			expect(lines.join('\n')).toMatch(
				/Missing on GitHub environment staging: OPERATOR_PASSWORD at/,
			);
			expect(state().github.staging).toEqual({ CLOUDFLARE_API_TOKEN: 'x' });
			expect(result.ok).toBe(false);
		});
	});

	describe('--generate', () => {
		const STAGING = { app: 'stream', environment: 'staging' };

		it.each([
			[
				'a secret the map refuses to generate',
				{ target: STAGING, generate: ['MELEE_KEY'] },
				/MELEE_KEY: a new Melee key needs its version var bumped/,
			],
			[
				'a secret its provider issues',
				{ target: STAGING, generate: ['ABLY_KEY'] },
				/ABLY_KEY is issued by its provider/,
			],
			[
				'a name the Installation does not have',
				{ target: STAGING, generate: ['NOPE'] },
				/NOPE is not one of stream in staging's secrets/,
			],
			[
				'a check',
				{ target: STAGING, generate: ['AUTH_SECRET'], check: true },
				/--check .* generates nothing/,
			],
			[
				'a GitHub environment',
				{ target: { github: 'staging' }, generate: ['CLOUDFLARE_API_TOKEN'] },
				/Only a Worker secret is generated/,
			],
		])('refuses %s, and changes nothing', (_case, options, refusal) => {
			const { sync, state } = setUp();

			expect(() => sync(options)).toThrow(refusal);
			expect(state()).toMatchObject({ vaults: VAULTS, workers: {} });
		});

		it('writes a new random value into 1Password, warns what it does, then syncs it', () => {
			const { sync, state, lines } = setUp({ workers: { stream: { AUTH_SECRET: 'old' } } });

			sync({ target: STAGING, generate: ['AUTH_SECRET'] });

			const recorded = state().vaults.Keepr!['stream-staging']!;
			expect(recorded.AUTH_SECRET).toMatch(/^[A-Za-z0-9+/]{43}=$/);
			expect(recorded).toEqual({
				...VAULTS.Keepr!['stream-staging'],
				AUTH_SECRET: recorded.AUTH_SECRET,
			});
			expect(state().workers.stream!.AUTH_SECRET).toBe(recorded.AUTH_SECRET);
			expect(lines.join('\n')).toMatch(/Warning: a new AUTH_SECRET signs every User out/);
		});
	});

	describe('never shows a value', () => {
		it.each([
			['a Worker sync', { target: { app: 'stream', environment: 'production' } }],
			['a GitHub sync', { target: { github: 'staging' } }],
			[
				'a generated secret',
				{ target: { app: 'stream', environment: 'staging' }, generate: ['SCREEN_KEY'] },
			],
		])('in any argument or line of %s', (_case, options) => {
			const { sync, state, lines } = setUp();

			sync(options);

			const generated = state().vaults.Keepr!['stream-staging']!.SCREEN_KEY!;
			const shown = [...state().argv.flat(), ...lines].join('\n');
			for (const value of [...Object.values(VALUES), generated]) expect(shown).not.toContain(value);
		});

		it('in what a failing tool prints', () => {
			const { sync, state } = setUp({ signedOut: { wrangler: true } });

			let failure = '';
			try {
				sync({ target: { app: 'stream', environment: 'staging' } });
			} catch (error) {
				failure = (error as Error).message;
			}

			expect(failure).toMatch(/wrangler secret bulk failed: .*Not logged in/);
			for (const value of Object.values(VALUES)) expect(failure).not.toContain(value);
			expect(state().workers).toEqual({});
		});
	});

	describe('the command line', () => {
		const CLI = join(import.meta.dirname, '../scripts/secrets/cli.mjs');

		function run(args: string[], cwd: string, env: Record<string, string>) {
			return spawnSync(process.execPath, [CLI, ...args], {
				cwd,
				env: { ...process.env, ...env },
				encoding: 'utf8',
			});
		}

		it.each([
			['no target', []],
			['an app without an Environment', ['--app', 'stream']],
			[
				'an Installation and a GitHub environment at once',
				['--app', 'stream', '--env', 'staging', '--github', 'staging'],
			],
			['an Environment beside a GitHub environment', ['--github', 'staging', '--env', 'staging']],
			['an unknown option', ['--github', 'staging', '--force']],
		])('refuses %s, touching nothing', (_case, args) => {
			const { root, env, state } = setUp();

			const result = run(args, root, env);

			expect(result.status).toBe(2);
			expect(result.stderr).toContain('usage: pnpm secrets:sync');
			expect(state().argv).toEqual([]);
		});

		it.each([
			['a sync that set everything', ['--github', 'staging'], 0],
			['a check that finds a gap', ['--app', 'stream', '--env', 'staging', '--check'], 1],
			['a refusal', ['--app', 'stream', '--env', 'staging', '--generate', 'ABLY_KEY'], 1],
		])('exits as %s does, from anywhere in the checkout', (_case, args, status) => {
			const { root, env } = setUp();

			expect(run(args, join(root, 'apps/stream'), env).status).toBe(status);
		});
	});

	it("stops at 1Password's refusal, having set nothing", () => {
		const { sync, state } = setUp({ signedOut: { op: true } });

		expect(() => sync({ target: { app: 'stream', environment: 'staging' } })).toThrow(
			/op item get failed: .*not currently signed in/,
		);
		expect(state().workers).toEqual({});
	});
});
