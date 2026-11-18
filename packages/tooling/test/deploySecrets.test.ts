import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { afterEach, describe, expect, it } from 'vitest';
import type { Descriptor, Release } from '../scripts/deploy/release.mjs';
import { requireSecrets, wranglerSecretNames, wranglerVars } from '../scripts/deploy/secrets.mjs';

const APP_CONFIG = '.output/server/wrangler.json';
const VALIDATOR_CONFIG = 'workers/silent-video-validator/wrangler.jsonc';
const REQUIRED = ['NUXT_BETTER_AUTH_SECRET', 'NUXT_ABLY_API_KEY'];

/** The source Wrangler configs, by path: production's vars at the top level, staging's in its block. */
type Configs = Record<
	string,
	{ vars?: Record<string, unknown>; staging?: Record<string, unknown> }
>;

const CONFIGS: Configs = {
	'wrangler.jsonc': {
		vars: { NUXT_KEY_VERSION: 'v2', NUXT_API_URL: 'https://api.example' },
		staging: { NUXT_KEY_VERSION: '1' },
	},
	[VALIDATOR_CONFIG]: {},
};

function writeConfigs(dir: string, configs: Configs) {
	for (const [path, { vars, staging }] of Object.entries(configs)) {
		mkdirSync(dirname(join(dir, path)), { recursive: true });
		writeFileSync(
			join(dir, path),
			JSON.stringify({ ...(vars && { vars }), env: { staging: staging ? { vars: staging } : {} } }),
		);
	}
}

function release(appDir: string, parts: Descriptor['parts']): Release {
	return {
		app: 'stream',
		appDir,
		version: '1.9.0',
		verifies: 'release',
		descriptor: {
			app: 'stream',
			build: [],
			output: '.output',
			worker: { source: 'wrangler.jsonc', config: APP_CONFIG, secrets: REQUIRED },
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
		}: { environment?: string; parts?: Descriptor['parts']; configs?: Configs } = {},
	) {
		const dir = mkdtempSync(join(tmpdir(), 'keepr-secrets-'));
		dirs.push(dir);
		writeConfigs(dir, configs);
		const target = release(dir, parts);
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
				configuredVars: wranglerVars({
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

	it('refuses naming each missing secret and the command that sets it, and not those set', () => {
		const { run } = check({ [`${APP_CONFIG} staging`]: ['NUXT_ABLY_API_KEY'] });

		expect(run).toThrow(
			`stream's Worker lacks NUXT_BETTER_AUTH_SECRET: set each from apps/stream with wrangler secret put <NAME> --config ${APP_CONFIG} --env staging`,
		);
		expect(run).not.toThrow(/NUXT_ABLY_API_KEY/);
	});

	it("names every Worker's missing secrets in one refusal, a part's with its own configuration", () => {
		const { run } = check(
			{ [`${APP_CONFIG} `]: [], [`${VALIDATOR_CONFIG} `]: [] },
			{
				environment: 'production',
				parts: { validator: { config: VALIDATOR_CONFIG, secrets: ['VALIDATOR_TOKEN'] } },
			},
		);

		expect(run).toThrow(
			/stream's Worker lacks NUXT_BETTER_AUTH_SECRET, NUXT_ABLY_API_KEY: .*--config \.output\/server\/wrangler\.json;.*stream's validator lacks VALIDATOR_TOKEN: .*--config workers\/silent-video-validator\/wrangler\.jsonc\b/,
		);
	});

	it('refuses a Worker that does not exist yet, which has none of its secrets, saying to set them first', () => {
		const { run } = check({});

		expect(run).toThrow(
			/stream's Worker does not exist in staging yet, so it lacks NUXT_BETTER_AUTH_SECRET, NUXT_ABLY_API_KEY: set each first, which creates it, .*wrangler secret put <NAME> --config \.output\/server\/wrangler\.json --env staging/,
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
		['the top-level configuration', 'production', `${APP_CONFIG} `, ''],
		["the Environment's Wrangler block", 'staging', `${APP_CONFIG} staging`, ' --env staging'],
	])(
		'refuses a Worker secret named like a var %s sets, naming the command that deletes it',
		(_case, environment, key, envFlag) => {
			const { run } = check({ [key]: [...REQUIRED, 'NUXT_KEY_VERSION'] }, { environment });

			expect(run).toThrow(
				`stream's Worker has a secret and a var both named NUXT_KEY_VERSION: delete each secret from apps/stream with wrangler secret delete <NAME> --config ${APP_CONFIG}${envFlag}`,
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

	it("refuses a var the Environment's configuration leaves empty, a placeholder, in any Worker", () => {
		const { run } = check(
			{ [`${APP_CONFIG} `]: REQUIRED },
			{
				environment: 'production',
				configs: {
					'wrangler.jsonc': {
						vars: { NUXT_KEY_VERSION: ' ', NUXT_API_URL: 'https://api.example' },
					},
					[VALIDATOR_CONFIG]: { vars: { VALIDATOR_MODE: '' } },
				},
			},
		);

		expect(run).toThrow(
			/stream's Worker: wrangler\.jsonc leaves NUXT_KEY_VERSION empty for production, a placeholder: set its value.*stream's validator: workers\/silent-video-validator\/wrangler\.jsonc leaves VALIDATOR_MODE empty/,
		);
		expect(run).not.toThrow(/NUXT_API_URL/);
	});
});
