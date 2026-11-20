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
		secrets: ['AUTH_SECRET', 'SCREEN_KEY', 'MELEE_KEY', 'ISSUED_KEY'],
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
		release: references('keepr-release', ['KEEPR_RELEASE_APP_ID', 'KEEPR_RELEASE_APP_PRIVATE_KEY']),
	},
};

/** Values no output, argument or error may ever show. */
const VALUES = {
	AUTH_SECRET: 'auth-value-1',
	SCREEN_KEY: 'screen-value-2',
	ISSUED_KEY: 'issued-value-3',
	CLOUDFLARE_API_TOKEN: 'cf-value-4',
	OPERATOR_PASSWORD: 'multi\nline-value-5',
	KEEPR_RELEASE_APP_ID: 'app-id-value-6',
	KEEPR_RELEASE_APP_PRIVATE_KEY:
		'-----BEGIN RSA PRIVATE KEY-----\nkey-body-value-7\nkey-body-value-8\n-----END RSA PRIVATE KEY-----\n',
};

const VAULTS: FakeState['vaults'] = {
	Keepr: {
		'stream-staging': {
			AUTH_SECRET: VALUES.AUTH_SECRET,
			SCREEN_KEY: VALUES.SCREEN_KEY,
			MELEE_KEY: '',
			ISSUED_KEY: VALUES.ISSUED_KEY,
			CARD_KEY: '',
		},
		'stream-production': {
			AUTH_SECRET: VALUES.AUTH_SECRET,
			SCREEN_KEY: VALUES.SCREEN_KEY,
			MELEE_KEY: '',
			ISSUED_KEY: VALUES.ISSUED_KEY,
			CARD_KEY: '',
		},
		'github-staging': {
			CLOUDFLARE_API_TOKEN: VALUES.CLOUDFLARE_API_TOKEN,
			OPERATOR_PASSWORD: VALUES.OPERATOR_PASSWORD,
		},
		'keepr-release': {
			KEEPR_RELEASE_APP_ID: VALUES.KEEPR_RELEASE_APP_ID,
			KEEPR_RELEASE_APP_PRIVATE_KEY: VALUES.KEEPR_RELEASE_APP_PRIVATE_KEY,
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
			state: {
				vaults: structuredClone(VAULTS),
				workers: {},
				github: { staging: {}, release: {} },
				...state,
			},
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
						ISSUED_KEY: VALUES.ISSUED_KEY,
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
				/Missing on Worker stream.*: SCREEN_KEY at .*, MELEE_KEY at .*, ISSUED_KEY at .*, CARD_KEY \(optional\)/,
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
				workers: { stream: { AUTH_SECRET: 'a', SCREEN_KEY: 'b', MELEE_KEY: 'c', ISSUED_KEY: 'd' } },
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

	it.each([
		[
			'an Installation by its Worker',
			{ app: 'stream', environment: 'staging' },
			'stream in staging: Worker stream (apps/stream/wrangler.jsonc --env staging).',
		],
		['a GitHub environment once', { github: 'staging' }, 'GitHub environment staging.'],
	])('opens by naming %s', (_case, target, heading) => {
		const { sync, lines } = setUp();

		sync({ target });

		expect(lines[0]).toBe(heading);
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

	// The 1Password app saves a concealed field as one line, so a pasted key's
	// line breaks become spaces, and GitHub's App token action cannot decode it.
	describe('a private key whose line breaks were lost', () => {
		const RELEASE = { github: 'release' };
		const KEY = VALUES.KEEPR_RELEASE_APP_PRIVATE_KEY;

		function withKey(key: string, release: Record<string, string> = {}) {
			const vaults = structuredClone(VAULTS);
			vaults.Keepr!['keepr-release']!.KEEPR_RELEASE_APP_PRIVATE_KEY = key;
			return setUp({ vaults, github: { release } });
		}

		it('refuses the sync, naming the secret, its reference and the fix, and sets nothing', () => {
			const { sync, state } = withKey(KEY.replaceAll('\n', ' ').trim());

			let failure = '';
			try {
				sync({ target: RELEASE });
			} catch (error) {
				failure = (error as Error).message;
			}

			expect(failure).toMatch(
				/KEEPR_RELEASE_APP_PRIVATE_KEY at op:\/\/Keepr\/keepr-release\/KEEPR_RELEASE_APP_PRIVATE_KEY[^]*no line break/,
			);
			expect(failure).toContain(
				'op item edit keepr-release --vault Keepr "KEEPR_RELEASE_APP_PRIVATE_KEY[password]=$(cat key.pem)"',
			);
			expect(failure).not.toMatch(/key-body-value/);
			expect(state().github.release).toEqual({});
		});

		it('with --check, names it and fails, though GitHub has every secret', () => {
			const { sync, lines } = withKey(KEY.replaceAll('\n', ' ').trim(), {
				KEEPR_RELEASE_APP_ID: 'x',
				KEEPR_RELEASE_APP_PRIVATE_KEY: 'y',
			});

			const result = sync({ target: RELEASE, check: true });

			expect(lines.join('\n')).toMatch(/KEEPR_RELEASE_APP_PRIVATE_KEY at op:[^]*no line break/);
			expect(lines.join('\n')).not.toMatch(/key-body-value/);
			expect(result.ok).toBe(false);
		});

		it.each([
			['its header joined to its body', KEY.replace('-----\nkey-body', '----- key-body')],
			['two body lines joined by a space', KEY.replace('value-7\nkey', 'value-7 key')],
			[
				'two body lines run together',
				KEY.replace(
					'value-7\nkey',
					'value-7key-body-value-7key-body-value-7key-body-value-7key-body-value-7key',
				),
			],
		])('refuses a key with only some line breaks lost: %s', (_case, key) => {
			const { sync, state } = withKey(key);

			expect(() => sync({ target: RELEASE })).toThrow(
				/KEEPR_RELEASE_APP_PRIVATE_KEY at op:[^]*line break/,
			);
			expect(state().github.release).toEqual({});
		});

		it('syncs a key whose line breaks were kept', () => {
			const { sync, state } = withKey(KEY);

			const result = sync({ target: RELEASE });

			expect(state().github.release!.KEEPR_RELEASE_APP_PRIVATE_KEY).toBe(KEY);
			expect(result.ok).toBe(true);
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
				{ target: STAGING, generate: ['ISSUED_KEY'] },
				/ISSUED_KEY is issued by its provider/,
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

		// A new value 1Password holds that no destination can take would sign out everyone the old one served.
		it('confirms the destination answers before it writes 1Password, and changes nothing when it does not', () => {
			const { sync, state } = setUp({ signedOut: { wrangler: true } });

			expect(() => sync({ target: STAGING, generate: ['AUTH_SECRET'] })).toThrow(
				/wrangler secret list failed[^]*Nothing was changed/,
			);
			expect(state().vaults).toEqual(VAULTS);
		});

		it('names the command that finishes the sync when the destination fails after 1Password took the new value', () => {
			const { sync, state } = setUp({
				failsBulk: true,
				workers: { stream: { AUTH_SECRET: 'old' } },
			});

			let failure = '';
			try {
				sync({ target: STAGING, generate: ['AUTH_SECRET'] });
			} catch (error) {
				failure = (error as Error).message;
			}

			const generated = state().vaults.Keepr!['stream-staging']!.AUTH_SECRET!;
			expect(generated).not.toBe(VALUES.AUTH_SECRET);
			expect(failure).toContain('1Password holds the new AUTH_SECRET');
			expect(failure).toContain('pnpm secrets:sync --app stream --env staging');
			expect(failure).not.toContain(generated);
			expect(state().workers).toEqual({ stream: { AUTH_SECRET: 'old' } });
		});

		// A value only a Worker holds can never be read back (ADR-0134).
		it('refuses to sync a value 1Password did not keep, though op said it did', () => {
			const { sync, state, lines } = setUp({
				opDropsEdits: true,
				workers: { stream: { AUTH_SECRET: 'old' } },
			});

			expect(() => sync({ target: STAGING, generate: ['AUTH_SECRET'] })).toThrow(
				/1Password did not keep the new AUTH_SECRET at op:\/\/Keepr\/stream-staging\/AUTH_SECRET.*Nothing was set/,
			);
			expect(state().workers).toEqual({ stream: { AUTH_SECRET: 'old' } });
			expect(lines.join('\n')).not.toMatch(/Generated/);
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
			// op takes a value only as an assignment (ADR-0135): the generated one's single argument.
			const assignment = `SCREEN_KEY[password]=${generated}`;
			const shown = [...state().argv.flat(), ...lines]
				.filter((text) => text !== assignment)
				.join('\n');
			for (const value of [...Object.values(VALUES), generated]) expect(shown).not.toContain(value);
		});

		// A tool that echoes the JSON it was handed escapes each line break.
		it("in a failing tool's echo of a multi-line value, JSON-escaped", () => {
			const vaults = structuredClone(VAULTS);
			vaults.Keepr!['stream-staging']!.AUTH_SECRET = 'first-line-9\nsecond-line-10';
			const { sync } = setUp({ vaults, signedOut: { wrangler: true } });

			let failure = '';
			try {
				sync({ target: { app: 'stream', environment: 'staging' } });
			} catch (error) {
				failure = (error as Error).message;
			}

			expect(failure).toMatch(/Not logged in/);
			expect(failure).not.toMatch(/first-line-9|second-line-10/);
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

	it("stops at 1Password's refusal, having set nothing", () => {
		const { sync, state } = setUp({ signedOut: { op: true } });

		expect(() => sync({ target: { app: 'stream', environment: 'staging' } })).toThrow(
			/op item get failed: .*not currently signed in/,
		);
		expect(state().workers).toEqual({});
	});
});
