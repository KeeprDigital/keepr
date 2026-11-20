import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { afterEach, describe, expect, it } from 'vitest';
import type { Descriptor, Release } from '../scripts/deploy/release.mjs';
import {
	requireSecrets,
	wranglerSecretNames,
	wranglerSourceConfig,
} from '../scripts/deploy/secrets.mjs';

const APP_CONFIG = '.output/server/wrangler.json';
const VALIDATOR_CONFIG = 'workers/silent-video-validator/wrangler.jsonc';
const REQUIRED = ['NUXT_BETTER_AUTH_SECRET', 'NUXT_ABLY_API_KEY'];

/** A source Wrangler config's top level, or its `env.staging` block. */
type Block = { name?: string; vars?: Record<string, unknown> };
/** The source Wrangler configs, by path: production's at the top level, staging's in its block. */
type Configs = Record<string, Block & { staging?: Block }>;

/** As apps/stream's: the build names production's Worker, and `env.staging` names its own. */
const CONFIGS: Configs = {
	'wrangler.jsonc': {
		vars: { NUXT_KEY_VERSION: 'v2', NUXT_API_URL: 'https://api.example' },
		staging: { name: 'stream', vars: { NUXT_KEY_VERSION: '1' } },
	},
	[VALIDATOR_CONFIG]: { name: 'stream-validator' },
};

function writeConfigs(dir: string, configs: Configs) {
	for (const [path, { staging = {}, ...topLevel }] of Object.entries(configs)) {
		mkdirSync(dirname(join(dir, path)), { recursive: true });
		writeFileSync(join(dir, path), JSON.stringify({ ...topLevel, env: { staging } }));
	}
}

function release(appDir: string, parts: Descriptor['parts'], name?: string): Release {
	return {
		app: 'stream',
		appDir,
		version: '1.9.0',
		verifies: 'release',
		descriptor: {
			app: 'stream',
			build: [],
			output: '.output',
			worker: {
				source: 'wrangler.jsonc',
				config: APP_CONFIG,
				...(name !== undefined && { name }),
				secrets: REQUIRED,
			},
			databases: [{ binding: 'DB' }],
			environments: {
				production: { url: 'https://stream.keepr.digital' },
				staging: { url: 'https://stream.keepr-staging.digital', wranglerEnv: 'staging' },
			},
			parts,
		},
	};
}

/** What the fake Wrangler answers `secret list` for `<config> <env>`: the names set, or its error. */
type Answers = Record<string, string[] | string>;

const NOT_FOUND = [
	'✘ [ERROR] Worker "stream" (env: staging) not found.',
	'',
	'If this is a new Worker, run `wrangler deploy` first to create it.',
].join('\n');

/**
 * Wrangler's `secret list --format json`, faked as an executable: it answers
 * each configuration and `--env` it is given from `answers`, and fails as
 * Wrangler does for a Worker that does not exist when it has no answer.
 */
function fakeWrangler(dir: string, answers: Answers) {
	const path = join(dir, 'wrangler');
	writeFileSync(
		path,
		`#!${process.execPath}
const answers = ${JSON.stringify(answers)};
const args = process.argv.slice(2);
const at = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : '');
if (args[0] !== 'secret' || args[1] !== 'list' || at('--format') !== 'json') {
	console.error('unexpected: ' + args.join(' '));
	process.exit(2);
}
const answer = answers[at('--config') + ' ' + at('--env')];
if (answer === undefined) {
	console.error(${JSON.stringify(NOT_FOUND)});
	process.exit(1);
}
if (typeof answer === 'string') {
	console.error(answer);
	process.exit(1);
}
console.log(JSON.stringify(answer.map((name) => ({ name, type: 'secret_text' })), null, '  '));
`,
	);
	chmodSync(path, 0o755);
	return path;
}

/**
 * A deploy refuses an Installation that lacks a Worker secret its descriptor
 * requires, read from the target Worker before anything remote changes: a
 * Worker with no secrets passes every gate and still cannot sign anyone in.
 */
describe('the Worker secrets an Installation requires', () => {
	const dirs: string[] = [];
	afterEach(() => {
		for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	function check(
		answers: Answers,
		{
			environment = 'staging',
			parts = { validator: { config: VALIDATOR_CONFIG } },
			configs = CONFIGS,
			name = 'stream',
		}: {
			environment?: string;
			parts?: Descriptor['parts'];
			configs?: Configs;
			/** The descriptor's `worker.name`; null for none. */
			name?: string | null;
		} = {},
	) {
		const dir = mkdtempSync(join(tmpdir(), 'keepr-secrets-'));
		dirs.push(dir);
		writeConfigs(dir, configs);
		const target = release(dir, parts, name ?? undefined);
		const lines: string[] = [];
		const run = () =>
			requireSecrets({
				release: target,
				environment,
				secretNames: wranglerSecretNames({
					wrangler: fakeWrangler(dir, answers),
					appDir: dir,
					wranglerEnv: target.descriptor.environments[environment]?.wranglerEnv,
				}),
				sourceConfig: wranglerSourceConfig({
					appDir: dir,
					wranglerEnv: target.descriptor.environments[environment]?.wranglerEnv,
				}),
				log: (line) => lines.push(line),
			});
		return { run, lines };
	}

	it.each([
		['the top-level configuration', 'production', `${APP_CONFIG} `],
		["the Environment's Wrangler block", 'staging', `${APP_CONFIG} staging`],
	])(
		'passes when every required secret is set on the Worker in %s, asking no Worker that requires none',
		(_case, environment, key) => {
			const { run, lines } = check(
				{ [key]: [...REQUIRED, 'NUXT_BANDAI_KEEPR_API_KEY'] },
				{ environment },
			);

			expect(run).not.toThrow();
			expect(lines.join('\n')).toContain(`stream's Worker has its 2 required secrets`);
		},
	);

	/*
	 * A person runs the hint, so it reaches the Worker as `pnpm secrets:sync`
	 * does, through the source configuration: with a login that reaches both
	 * accounts, the built one's `--env staging` reaches Production.
	 */
	it.each([
		[
			'Staging, whose env block names the Worker',
			'staging',
			`${APP_CONFIG} staging`,
			'--config wrangler.jsonc --env staging',
		],
		[
			'Production, named by the descriptor where the top level leaves it to the build',
			'production',
			`${APP_CONFIG} `,
			'--config wrangler.jsonc --name stream',
		],
	])(
		'refuses in %s naming each missing secret and the command that sets it, and not those set',
		(_case, environment, key, flags) => {
			const { run } = check({ [key]: ['NUXT_ABLY_API_KEY'] }, { environment });

			expect(run).toThrow(
				`stream's Worker lacks NUXT_BETTER_AUTH_SECRET: set each with pnpm secrets:sync --app stream --env ${environment}, or from apps/stream with wrangler secret put <NAME> ${flags}.`,
			);
			expect(run).not.toThrow(/NUXT_ABLY_API_KEY|\.output/);
		},
	);

	it("names every Worker's missing secrets in one refusal, a part's through its own configuration", () => {
		const { run } = check(
			{ [`${APP_CONFIG} `]: [], [`${VALIDATOR_CONFIG} `]: [] },
			{
				environment: 'production',
				parts: { validator: { config: VALIDATOR_CONFIG, secrets: ['VALIDATOR_TOKEN'] } },
			},
		);

		expect(run).toThrow(
			`stream's Worker lacks NUXT_BETTER_AUTH_SECRET, NUXT_ABLY_API_KEY: set each with pnpm secrets:sync --app stream --env production, or from apps/stream with wrangler secret put <NAME> --config wrangler.jsonc --name stream; stream's validator lacks VALIDATOR_TOKEN: set each from apps/stream with wrangler secret put <NAME> --config ${VALIDATOR_CONFIG}.`,
		);
	});

	it('refuses a Worker that does not exist yet, which has none of its secrets, saying to set them first', () => {
		const { run } = check({});

		expect(run).toThrow(
			`stream's Worker does not exist in staging yet, so it lacks NUXT_BETTER_AUTH_SECRET, NUXT_ABLY_API_KEY: set each first, which creates it, with pnpm secrets:sync --app stream --env staging, or from apps/stream with wrangler secret put <NAME> --config wrangler.jsonc --env staging.`,
		);
	});

	it('refuses when Wrangler cannot list the secrets, with what it said', () => {
		const { run } = check({
			[`${APP_CONFIG} staging`]: '✘ [ERROR] Authentication error [code: 10000]',
		});

		expect(run).toThrow(/could not read stream's Worker's secrets in staging: .*code: 10000/);
	});

	/*
	 * A var and a Worker secret of one name leave which the Worker reads to
	 * Cloudflare, not the Release: neither wins, and the deploy refuses until the
	 * secret is deleted (ADR-0132).
	 */
	it.each([
		[
			'the top-level configuration',
			'production',
			`${APP_CONFIG} `,
			'--config wrangler.jsonc --name stream',
		],
		[
			"the Environment's Wrangler block",
			'staging',
			`${APP_CONFIG} staging`,
			'--config wrangler.jsonc --env staging',
		],
	])(
		'refuses a Worker secret named like a var %s sets, naming the command that deletes it',
		(_case, environment, key, flags) => {
			const { run } = check({ [key]: [...REQUIRED, 'NUXT_KEY_VERSION'] }, { environment });

			expect(run).toThrow(
				`stream's Worker has a secret and a var both named NUXT_KEY_VERSION: delete each secret from apps/stream with wrangler secret delete <NAME> ${flags}.`,
			);
		},
	);

	// Wrangler names `--name x --env y` Worker x-y, so no Worker's name is guessed.
	it.each([
		[
			'an env block that names no Worker',
			'staging',
			`${APP_CONFIG} staging`,
			{ configs: { ...CONFIGS, 'wrangler.jsonc': { staging: {} } } },
			"apps/stream/wrangler.jsonc's env.staging names no Worker.",
		],
		[
			'a top level and a descriptor that name none',
			'production',
			`${APP_CONFIG} `,
			{ name: null },
			"Neither apps/stream/wrangler.jsonc nor its deploy descriptor names stream's Worker.",
		],
	])(
		'refuses a Worker lacking a secret, saying no command reaches it, through %s',
		(_case, environment, key, options, why) => {
			const { run } = check({ [key]: [] }, { environment, ...options });

			expect(run).toThrow(
				`stream's Worker is refused in ${environment}, and no command reaches it: ${why}`,
			);
		},
	);

	it("passes a secret named like a var only another Environment's configuration sets", () => {
		const { run } = check(
			{ [`${APP_CONFIG} staging`]: [...REQUIRED, 'NUXT_API_URL'] },
			{ environment: 'staging' },
		);

		expect(run).not.toThrow();
	});
});
