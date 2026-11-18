import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { refuseAccountMismatch } from '../scripts/deploy/account.mjs';

/**
 * Each Environment's Wrangler configs name its account (ADR-0130), and Wrangler
 * prefers them to an exported `CLOUDFLARE_ACCOUNT_ID`. An export that disagrees
 * is an operator aiming at another account than the deploy would reach.
 */

const PRODUCTION = '3ec389380c7b82e6a172e6f351d4aad9';
const STAGING = '98e3d208fbb975ce573938b72ed9e7b8';

const APP = JSON.stringify({
	account_id: PRODUCTION,
	env: { staging: { account_id: STAGING } },
});
// The part's staging block names no account, so it inherits production's.
const PART = JSON.stringify({ account_id: PRODUCTION, env: { staging: {} } });

describe('the account a deploy reaches', () => {
	const roots: string[] = [];

	afterEach(() => {
		for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
	});

	function release({ app = APP, part = PART } = {}) {
		const appDir = mkdtempSync(join(tmpdir(), 'keepr-account-'));
		roots.push(appDir);
		for (const [path, content] of Object.entries({
			'wrangler.jsonc': `// the app\n${app}`,
			'workers/validator/wrangler.jsonc': part,
		})) {
			mkdirSync(dirname(join(appDir, path)), { recursive: true });
			writeFileSync(join(appDir, path), content);
		}
		return {
			app: 'stream',
			appDir,
			descriptor: {
				worker: { source: 'wrangler.jsonc', config: '.output/server/wrangler.json' },
				environments: {
					production: { url: 'https://stream.keepr.digital' },
					staging: { url: 'https://stream.keepr-staging.digital', wranglerEnv: 'staging' },
				},
				parts: { validator: { config: 'workers/validator/wrangler.jsonc' } },
			},
		};
	}

	it.each([
		['nothing is exported', 'staging', undefined, {}],
		['the export is the account the configs name', 'production', PRODUCTION, {}],
		// A Release from before configs named one: the export is all Wrangler has.
		['the configs name no account', 'production', STAGING, { app: '{}', part: '{}' }],
	])('deploys when %s', (_, environment, exported, files) => {
		expect(() =>
			refuseAccountMismatch({
				release: release(files),
				environment,
				env: { CLOUDFLARE_ACCOUNT_ID: exported },
			}),
		).not.toThrow();
	});

	it.each([
		["production's account exported for staging", 'staging', PRODUCTION, 'wrangler.jsonc'],
		["staging's account exported for production", 'production', STAGING, 'wrangler.jsonc'],
		[
			"an export the app's config agrees with and a part's, inherited, does not",
			'staging',
			STAGING,
			'workers/validator/wrangler.jsonc',
		],
	])('refuses %s, naming the config', (_, environment, exported, config) => {
		expect(() =>
			refuseAccountMismatch({
				release: release(),
				environment,
				env: { CLOUDFLARE_ACCOUNT_ID: exported },
			}),
		).toThrow(`${config} names another account for ${environment}`);
	});
});
