import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { afterEach, describe, expect, it } from 'vitest';
import type { Descriptor, Release } from '../scripts/deploy/release.mjs';
import { requireSecrets, wranglerSecretNames } from '../scripts/deploy/secrets.mjs';

const APP_CONFIG = '.output/server/wrangler.json';
const VALIDATOR_CONFIG = 'workers/silent-video-validator/wrangler.jsonc';
const REQUIRED = ['NUXT_BETTER_AUTH_SECRET', 'NUXT_ABLY_API_KEY'];

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
		}: { environment?: string; parts?: Descriptor['parts'] } = {},
	) {
		const dir = mkdtempSync(join(tmpdir(), 'keepr-secrets-'));
		dirs.push(dir);
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
});
