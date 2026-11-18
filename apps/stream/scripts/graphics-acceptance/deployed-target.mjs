/**
 * The one deployed target every `--deployed` gate runs against, resolved and
 * checked before any gate writes anything (#619).
 *
 * Most gates reach the installation over HTTP, so the acceptance URL alone says
 * where they write. The silent-video validator gate cannot: it stages fixtures
 * with Wrangler and triggers the Workflow directly, so before this it wrote to
 * whatever account Wrangler was logged into and the bucket its committed config
 * named, whatever URL the run was pointed at. The target here ties the two
 * together: one URL, one explicit account, and the bucket and Workflow the
 * installation that URL names actually binds.
 *
 * "The Installation" is a pair of Wrangler configs, the app's and the
 * validator's, resolved for one Environment (#525): production is their top
 * level, any other Environment their `env.<name>` block. Every consistency
 * rule is checked against the resolved pair, so a staging URL with
 * production's configs, or the reverse, is refused rather than quietly sending
 * the validator's writes to the other Environment.
 *
 * Resolution is pure. Nothing here opens a connection, which is what lets
 * `pnpm accept deployed` run it for the whole sequence before its first gate.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseJsonc } from '@keepr/tooling/scripts/jsonc.mjs';
import { AcceptanceFailure } from './evidence.mjs';
import { acceptanceOrigin } from './installation.mjs';
import { newOperatorPassword, operatorCredentialPlan } from './operator.mjs';

/** Wrangler's own name for the account, so the value it is given is the value it uses. */
export const ACCOUNT_ID_ENV = 'CLOUDFLARE_ACCOUNT_ID';

/** Names the Environment a deployed run targets; unset is production, so today's runs keep their target. */
export const ENVIRONMENT_ENV = 'STREAM_KEEPR_ACCEPTANCE_ENVIRONMENT';

/** The Environments a deployed run may target. Production's configs are the top level. */
export const ENVIRONMENTS = ['production', 'staging'];
const PRODUCTION = 'production';

const ACCOUNT_ID_PATTERN = /^[0-9a-f]{32}$/;
const STAGING_BINDING = 'GRAPHICS_ASSET_STAGING';
const VALIDATOR_SERVICE_BINDING = 'SILENT_VIDEO_PLAYBACK_VALIDATOR';
const WORKFLOW_BINDING = 'SILENT_VIDEO_VALIDATION_WORKFLOW';

const APP_CONFIG = new URL('../../wrangler.jsonc', import.meta.url);
const VALIDATOR_CONFIG = new URL(
	'../../workers/silent-video-validator/wrangler.jsonc',
	import.meta.url,
);

/**
 * The Environment a deployed run targets. An unknown name is refused rather
 * than read as production, since a typo would otherwise write to production.
 *
 * @param {Record<string, string | undefined>} env
 */
export function acceptanceEnvironment(env) {
	const named = env[ENVIRONMENT_ENV]?.trim() || PRODUCTION;
	if (!ENVIRONMENTS.includes(named))
		throw new AcceptanceFailure('harness-precondition-unmet', { reason: 'environment-unknown' });
	return named;
}

/**
 * Keys Wrangler carries from the top level into an `env` block. Bindings are
 * not among them, so a block that does not restate one has none.
 */
const INHERITED_KEYS = ['account_id', 'route', 'routes'];

/**
 * A Wrangler config as Wrangler resolves it for one Environment: the top level
 * for production, else its `env.<name>` block over the keys Wrangler inherits.
 * A Worker the block does not name is `<name>-<env>`, as Wrangler names it.
 */
function configFor(config, environment) {
	const { env: blocks, ...topLevel } = config;
	if (environment === PRODUCTION) return topLevel;
	const block = blocks?.[environment];
	if (!block) throw inconsistent('environment-unconfigured');
	const inherited = Object.fromEntries(
		INHERITED_KEYS.filter((key) => key in topLevel).map((key) => [key, topLevel[key]]),
	);
	return {
		...inherited,
		name: topLevel.name === undefined ? undefined : `${topLevel.name}-${environment}`,
		...block,
	};
}

/** The committed Installation's configs, every Environment's block included. */
export async function loadCommittedInstallation() {
	const [app, validator] = await Promise.all(
		[APP_CONFIG, VALIDATOR_CONFIG].map(async (url) => parseJsonc(await readFile(url, 'utf8'))),
	);
	return {
		app,
		validator,
		validatorConfigPath: fileURLToPath(VALIDATOR_CONFIG),
	};
}

function inconsistent(reason) {
	return new AcceptanceFailure('harness-target-inconsistent', { reason });
}

function bucketBound(config, binding) {
	return config.r2_buckets?.find((bucket) => bucket.binding === binding)?.bucket_name;
}

/** The staging bucket a Wrangler config binds, the one the validator reads sources from. */
export function stagingBucketOf(config) {
	return bucketBound(config, STAGING_BINDING);
}

/** Every host the app's config serves, from its `routes`. */
function servedHosts(app) {
	return (app.routes ?? [])
		.map((route) => (typeof route === 'string' ? route : route.pattern))
		.filter(Boolean)
		.map((pattern) => pattern.replace(/\/.*$/, '').toLowerCase());
}

/**
 * Everything a deployed run needs, or the first thing it lacks.
 *
 * Checked in the order a reader fixes them: the URL, the operator, the account,
 * then whether the Installation's configs, resolved for the Environment, agree
 * with each other and with the URL. Every refusal is an `AcceptanceFailure`
 * whose detail is a reason word or a configuration name, never a value.
 *
 * @param {{
 *   env: Record<string, string | undefined>,
 *   installation: { app: any, validator: any, validatorConfigPath: string },
 *   environment?: string,
 *   requireOperator?: boolean,
 * }} options
 */
export function resolveDeployedTarget({
	env,
	installation,
	environment = acceptanceEnvironment(env),
	requireOperator = true,
}) {
	const origin = acceptanceOrigin({ deployed: true, env });
	// Called for its refusal: it throws, with its notice, when no operator is
	// available. A cleanup retry signs in as nobody, so it does not ask.
	if (requireOperator) {
		operatorCredentialPlan({
			deployed: true,
			env,
			newPassword: newOperatorPassword(),
		});
	}

	const accountId = env[ACCOUNT_ID_ENV]?.trim();
	if (!accountId)
		throw new AcceptanceFailure('harness-precondition-unmet', {
			reason: `${ACCOUNT_ID_ENV} is unset`,
		});
	if (!ACCOUNT_ID_PATTERN.test(accountId)) throw inconsistent('account-malformed');

	const { validatorConfigPath } = installation;
	const app = configFor(installation.app, environment);
	const validator = configFor(installation.validator, environment);
	let host;
	try {
		host = new URL(origin).host.toLowerCase();
	} catch {
		throw inconsistent('origin-malformed');
	}
	if (!servedHosts(app).includes(host)) throw inconsistent('origin-not-installation');

	for (const config of [app, validator]) {
		if (config.account_id !== undefined && config.account_id !== accountId)
			throw inconsistent('account-mismatch');
	}

	const stagingBucket = bucketBound(validator, STAGING_BINDING);
	if (!stagingBucket || stagingBucket !== bucketBound(app, STAGING_BINDING))
		throw inconsistent('staging-bucket-mismatch');

	const service = app.services?.find(
		(entry) => entry.binding === VALIDATOR_SERVICE_BINDING,
	)?.service;
	if (!service || service !== validator.name) throw inconsistent('validator-service-mismatch');

	const workflow = validator.workflows?.find((entry) => entry.binding === WORKFLOW_BINDING)?.name;
	if (!workflow) throw inconsistent('workflow-unconfigured');

	return {
		origin,
		accountId,
		stagingBucket,
		workflow,
		validatorConfigPath,
		environment,
		// The validator's Wrangler commands select the same block the target was resolved from.
		...(environment === PRODUCTION ? {} : { wranglerEnv: environment }),
	};
}
