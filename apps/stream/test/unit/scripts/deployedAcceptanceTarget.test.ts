import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	ACCOUNT_ID_ENV,
	acceptanceEnvironment,
	ENVIRONMENT_ENV,
	loadCommittedInstallation,
	resolveDeployedTarget,
} from '../../../scripts/graphics-acceptance/deployed-target.mjs';
import {
	OPERATOR_EMAIL_ENV,
	OPERATOR_PASSWORD_ENV,
} from '../../../scripts/graphics-acceptance/operator.mjs';

/**
 * The deployed target every `--deployed` gate shares (#619).
 *
 * The validator gate writes with Wrangler rather than over HTTP, so pointing the
 * acceptance URL elsewhere used to leave its writes on whatever account Wrangler
 * happened to be logged into. The resolver is pure so every refusal can be read
 * without an account in front of it.
 */

const ACCOUNT = '0123456789abcdef0123456789abcdef';
const STAGING_ACCOUNT = 'fedcba9876543210fedcba9876543210';

const COMPLETE_ENV = {
	STREAM_KEEPR_BROWSER_ACCEPTANCE_URL: 'https://stream.keepr.digital/',
	[OPERATOR_EMAIL_ENV]: 'ops@keepr.digital',
	[OPERATOR_PASSWORD_ENV]: 'their-password',
	[ACCOUNT_ID_ENV]: ACCOUNT,
};

const APP = {
	routes: [{ pattern: 'stream.keepr.digital', custom_domain: true }],
	r2_buckets: [
		{ binding: 'GRAPHICS_ASSET_STAGING', bucket_name: 'stream-graphics-asset-staging' },
		{ binding: 'GRAPHICS_ASSET_CANONICAL', bucket_name: 'stream-graphics-asset-canonical' },
	],
	services: [
		{ binding: 'SILENT_VIDEO_PLAYBACK_VALIDATOR', service: 'stream-silent-video-validator' },
	],
	env: {
		staging: {
			name: 'stream',
			account_id: STAGING_ACCOUNT,
			routes: [{ pattern: 'stream.keepr-staging.digital', custom_domain: true }],
			r2_buckets: [
				{ binding: 'GRAPHICS_ASSET_STAGING', bucket_name: 'stream-graphics-asset-staging' },
			],
			services: [
				{ binding: 'SILENT_VIDEO_PLAYBACK_VALIDATOR', service: 'stream-silent-video-validator' },
			],
		},
	},
};

const VALIDATOR = {
	name: 'stream-silent-video-validator',
	r2_buckets: [{ binding: 'GRAPHICS_ASSET_STAGING', bucket_name: 'stream-graphics-asset-staging' }],
	workflows: [{ name: 'silent-video-validation', binding: 'SILENT_VIDEO_VALIDATION_WORKFLOW' }],
	env: {
		staging: {
			name: 'stream-silent-video-validator',
			r2_buckets: [
				{ binding: 'GRAPHICS_ASSET_STAGING', bucket_name: 'stream-graphics-asset-staging' },
			],
			workflows: [{ name: 'silent-video-validation', binding: 'SILENT_VIDEO_VALIDATION_WORKFLOW' }],
		},
	},
};

const STAGING_ENV = {
	...COMPLETE_ENV,
	STREAM_KEEPR_BROWSER_ACCEPTANCE_URL: 'https://stream.keepr-staging.digital',
	[ACCOUNT_ID_ENV]: STAGING_ACCOUNT,
	[ENVIRONMENT_ENV]: 'staging',
};

/** The staging block with `change` applied, the rest of each config as the fixture has it. */
function withStaging(config: typeof APP | typeof VALIDATOR, change: (block: any) => object) {
	return { ...config, env: { staging: change(config.env.staging) } };
}

function resolve(
	env: Record<string, string | undefined>,
	overrides: { app?: object; validator?: object } = {},
) {
	return resolveDeployedTarget({
		env,
		installation: {
			app: overrides.app ?? APP,
			validator: overrides.validator ?? VALIDATOR,
			validatorConfigPath: '/repo/workers/silent-video-validator/wrangler.jsonc',
		},
	});
}

afterEach(() => vi.restoreAllMocks());

describe('the deployed acceptance target', () => {
	it('names the account, bucket and Workflow of the installation the URL names', () => {
		expect(resolve(COMPLETE_ENV)).toEqual({
			origin: 'https://stream.keepr.digital',
			accountId: ACCOUNT,
			stagingBucket: 'stream-graphics-asset-staging',
			workflow: 'silent-video-validation',
			validatorConfigPath: '/repo/workers/silent-video-validator/wrangler.jsonc',
			environment: 'production',
		});
	});

	it('refuses an unset acceptance URL', () => {
		expect(() =>
			resolve({ ...COMPLETE_ENV, STREAM_KEEPR_BROWSER_ACCEPTANCE_URL: undefined }),
		).toThrow(expect.objectContaining({ code: 'harness-precondition-unmet' }));
	});

	it('refuses a run with no operator, before anything is written', () => {
		vi.spyOn(process.stderr, 'write').mockReturnValue(true);

		expect(() => resolve({ ...COMPLETE_ENV, [OPERATOR_PASSWORD_ENV]: undefined })).toThrow(
			expect.objectContaining({ code: 'harness-operator-unavailable' }),
		);
	});

	it('refuses to write with whichever account Wrangler happens to be logged into', () => {
		expect(() => resolve({ ...COMPLETE_ENV, [ACCOUNT_ID_ENV]: undefined })).toThrow(
			expect.objectContaining({
				code: 'harness-precondition-unmet',
				detail: { reason: 'CLOUDFLARE_ACCOUNT_ID is unset and the configs name no account' },
			}),
		);
		expect(() => resolve({ ...COMPLETE_ENV, [ACCOUNT_ID_ENV]: 'not-an-account' })).toThrow(
			expect.objectContaining({
				code: 'harness-target-inconsistent',
				detail: { reason: 'account-malformed' },
			}),
		);
	});

	it('refuses an alternate URL, so retargeting it cannot leave the validator writing production', () => {
		expect(() =>
			resolve({
				...COMPLETE_ENV,
				STREAM_KEEPR_BROWSER_ACCEPTANCE_URL: 'https://staging.keepr.digital',
			}),
		).toThrow(
			expect.objectContaining({
				code: 'harness-target-inconsistent',
				detail: { reason: 'origin-not-installation' },
			}),
		);
	});

	it('refuses an installation whose validator stages elsewhere than its app', () => {
		expect(() =>
			resolve(COMPLETE_ENV, {
				validator: {
					...VALIDATOR,
					r2_buckets: [{ binding: 'GRAPHICS_ASSET_STAGING', bucket_name: 'other' }],
				},
			}),
		).toThrow(
			expect.objectContaining({
				detail: { reason: 'staging-bucket-mismatch' },
			}),
		);
		expect(() =>
			resolve(COMPLETE_ENV, {
				validator: { ...VALIDATOR, name: 'some-other-validator' },
			}),
		).toThrow(
			expect.objectContaining({
				detail: { reason: 'validator-service-mismatch' },
			}),
		);
		expect(() =>
			resolve(COMPLETE_ENV, {
				validator: { ...VALIDATOR, workflows: [] },
			}),
		).toThrow(
			expect.objectContaining({
				detail: { reason: 'workflow-unconfigured' },
			}),
		);
	});

	it("refuses an account the installation's own config contradicts", () => {
		expect(() =>
			resolve(COMPLETE_ENV, {
				app: {
					...APP,
					account_id: 'f'.repeat(32),
				},
			}),
		).toThrow(
			expect.objectContaining({
				detail: { reason: 'account-mismatch' },
			}),
		);
		expect(
			resolve(COMPLETE_ENV, {
				validator: { ...VALIDATOR, account_id: ACCOUNT },
			}).accountId,
		).toBe(ACCOUNT);
	});

	it.each([
		[
			'production',
			COMPLETE_ENV,
			{ app: { ...APP, account_id: ACCOUNT }, validator: { ...VALIDATOR, account_id: ACCOUNT } },
			ACCOUNT,
		],
		// Only the app's block names it; the validator's Wrangler commands are handed it.
		['staging', STAGING_ENV, {}, STAGING_ACCOUNT],
	])("takes the account %s's configs name when none is exported", (_, env, overrides, account) => {
		expect(resolve({ ...env, [ACCOUNT_ID_ENV]: undefined }, overrides).accountId).toBe(account);
	});

	it('resolves a staging URL against the configs resolved for staging, and names its Wrangler env', () => {
		expect(resolve(STAGING_ENV)).toEqual({
			origin: 'https://stream.keepr-staging.digital',
			accountId: STAGING_ACCOUNT,
			stagingBucket: 'stream-graphics-asset-staging',
			workflow: 'silent-video-validation',
			validatorConfigPath: '/repo/workers/silent-video-validator/wrangler.jsonc',
			environment: 'staging',
			wranglerEnv: 'staging',
		});
	});

	// Each row reaches a refusal no other row does; the reason word is the contract.
	it.each([
		[
			"a staging URL with production's configs",
			{ ...STAGING_ENV, [ENVIRONMENT_ENV]: undefined },
			{},
			'origin-not-installation',
		],
		[
			"a production URL with staging's configs",
			{ ...COMPLETE_ENV, [ENVIRONMENT_ENV]: 'staging' },
			{},
			'origin-not-installation',
		],
		[
			"production's account with staging's configs",
			{ ...STAGING_ENV, [ACCOUNT_ID_ENV]: ACCOUNT },
			{},
			'account-mismatch',
		],
		[
			'an app and validator config that name two accounts, with none exported',
			{ ...COMPLETE_ENV, [ACCOUNT_ID_ENV]: undefined },
			{
				app: { ...APP, account_id: ACCOUNT },
				validator: { ...VALIDATOR, account_id: STAGING_ACCOUNT },
			},
			'account-mismatch',
		],
		[
			'staging, when the configs have no staging block',
			STAGING_ENV,
			{ app: { ...APP, env: undefined } },
			'environment-unconfigured',
		],
		// Wrangler does not inherit bindings into an env block, so neither does the resolver.
		[
			'a staging block that does not restate its bucket',
			STAGING_ENV,
			{ validator: withStaging(VALIDATOR, ({ r2_buckets: _, ...block }) => block) },
			'staging-bucket-mismatch',
		],
		// Wrangler names an env's Worker `<name>-<env>` unless the block names it.
		[
			'a staging validator block that does not name its Worker',
			STAGING_ENV,
			{ validator: withStaging(VALIDATOR, ({ name: _, ...block }) => block) },
			'validator-service-mismatch',
		],
	])('refuses %s', (_, env, overrides, reason) => {
		expect(() => resolve(env, overrides)).toThrow(
			expect.objectContaining({ code: 'harness-target-inconsistent', detail: { reason } }),
		);
	});

	it.each([
		['production when none is named', undefined, 'production'],
		['staging when it is named', 'staging', 'staging'],
	])('targets %s', (_, named, environment) => {
		expect(acceptanceEnvironment({ [ENVIRONMENT_ENV]: named })).toBe(environment);
	});

	it('refuses an Environment it does not know, rather than guessing one', () => {
		expect(() => acceptanceEnvironment({ [ENVIRONMENT_ENV]: 'prod' })).toThrow(
			expect.objectContaining({
				code: 'harness-precondition-unmet',
				detail: { reason: 'environment-unknown' },
			}),
		);
	});

	it('resolves the committed production installation', async () => {
		const installation = await loadCommittedInstallation();

		expect(installation.validatorConfigPath).toBe(
			join(import.meta.dirname, '../../../workers/silent-video-validator/wrangler.jsonc'),
		);
		expect(
			resolveDeployedTarget({
				env: { ...COMPLETE_ENV, [ACCOUNT_ID_ENV]: undefined },
				installation,
			}),
		).toMatchObject({
			accountId: '3ec389380c7b82e6a172e6f351d4aad9',
			stagingBucket: 'stream-graphics-asset-staging',
			workflow: 'silent-video-validation',
		});
	});
});
