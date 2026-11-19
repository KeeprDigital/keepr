import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Descriptor } from '../scripts/deploy/release.mjs';
import { deployableApps, readRelease } from '../scripts/deploy/release.mjs';
import { githubSecrets, readSecretsMap, workerSecrets } from '../scripts/secrets/map.mjs';

const ROOT = join(import.meta.dirname, '../../..');

const DESCRIPTOR: Descriptor = {
	app: 'stream',
	build: [],
	output: '.output',
	worker: {
		source: 'wrangler.jsonc',
		config: '.output/server/wrangler.json',
		secrets: ['AUTH_SECRET', 'API_KEY'],
	},
	databases: [],
	environments: {
		production: { url: 'https://stream.example' },
		staging: { url: 'https://stream-staging.example', wranglerEnv: 'staging' },
	},
	parts: {},
};

const ref = (item: string, field: string) => `op://Keepr/${item}/${field}`;

function map(staging: Record<string, string>, extra: Record<string, unknown> = {}) {
	return {
		workers: {
			stream: {
				environments: {
					staging,
					production: {
						AUTH_SECRET: ref('stream-production', 'AUTH_SECRET'),
						API_KEY: ref('stream-production', 'API_KEY'),
					},
				},
				...extra,
			},
		},
		github: {},
	};
}

const AGREEING = {
	AUTH_SECRET: ref('stream-staging', 'AUTH_SECRET'),
	API_KEY: ref('stream-staging', 'API_KEY'),
};

describe("an Installation's Worker secrets", () => {
	it("are the descriptor's required secrets and the map's optional ones, each with its 1Password reference", () => {
		const secrets = workerSecrets(
			map({ ...AGREEING, CARD_KEY: ref('stream-staging', 'CARD_KEY') }, { optional: ['CARD_KEY'] }),
			DESCRIPTOR,
			'staging',
		);

		expect(secrets).toEqual([
			{
				name: 'AUTH_SECRET',
				ref: { vault: 'Keepr', item: 'stream-staging', field: 'AUTH_SECRET' },
				optional: false,
			},
			{
				name: 'API_KEY',
				ref: { vault: 'Keepr', item: 'stream-staging', field: 'API_KEY' },
				optional: false,
			},
			{
				name: 'CARD_KEY',
				ref: { vault: 'Keepr', item: 'stream-staging', field: 'CARD_KEY' },
				optional: true,
			},
		]);
	});

	it.each([
		[
			'lacks a secret the descriptor requires',
			map({ AUTH_SECRET: AGREEING.AUTH_SECRET }),
			/lacks API_KEY/,
		],
		[
			'names one the descriptor does not require and does not call optional',
			map({ ...AGREEING, STALE: ref('stream-staging', 'STALE') }),
			/STALE.*neither required.*nor optional/,
		],
		[
			'calls a required secret optional',
			map(AGREEING, { optional: ['API_KEY'] }),
			/API_KEY is required.*not optional/,
		],
		[
			'gives a reference that is not op://<vault>/<item>/<field>',
			map({ ...AGREEING, API_KEY: 'op://Keepr/stream-staging' }),
			/API_KEY.*not an op:\/\/<vault>\/<item>\/<field> reference/,
		],
	])('refuse a map that %s', (_case, secretsMap, problem) => {
		expect(() => workerSecrets(secretsMap, DESCRIPTOR, 'staging')).toThrow(problem);
	});

	it('refuse an Environment the map does not name', () => {
		const { staging: _, ...production } = map(AGREEING).workers.stream.environments;
		const secretsMap = { workers: { stream: { environments: production } }, github: {} };

		expect(() => workerSecrets(secretsMap, DESCRIPTOR, 'staging')).toThrow(
			/names no secrets for stream in staging/,
		);
	});

	it('refuse a part that requires secrets, which the sync does not set', () => {
		const descriptor = {
			...DESCRIPTOR,
			parts: { validator: { config: 'validator.jsonc', secrets: ['PART_KEY'] } },
		};

		expect(() => workerSecrets(map(AGREEING), descriptor, 'staging')).toThrow(
			/validator requires PART_KEY/,
		);
	});
});

describe("a GitHub environment's secrets", () => {
	it('are what the map names for it', () => {
		const secretsMap = {
			workers: {},
			github: { release: { APP_ID: ref('keepr-release', 'APP_ID') } },
		};

		expect(githubSecrets(secretsMap, 'release')).toEqual([
			{
				name: 'APP_ID',
				ref: { vault: 'Keepr', item: 'keepr-release', field: 'APP_ID' },
				optional: false,
			},
		]);
	});

	it('refuse an environment the map does not name', () => {
		expect(() => githubSecrets({ workers: {}, github: {} }, 'staging')).toThrow(
			/names no secrets for the GitHub environment staging/,
		);
	});
});

// The map adds only where 1Password keeps each value: the names are each descriptor's.
describe('the committed secrets map', () => {
	const secretsMap = readSecretsMap(ROOT);

	it.each(
		deployableApps(ROOT).flatMap((app) => {
			const { descriptor } = readRelease({ root: ROOT, app });
			return Object.keys(descriptor.environments).map((environment) => ({
				app,
				environment,
				descriptor,
			}));
		}),
	)("agrees with $app's descriptor in $environment", ({ descriptor, environment }) => {
		expect(() => workerSecrets(secretsMap, descriptor, environment)).not.toThrow();
	});

	it.each(Object.keys(secretsMap.github))('resolves the GitHub environment %s', (environment) => {
		expect(githubSecrets(secretsMap, environment).length).toBeGreaterThan(0);
	});
});
