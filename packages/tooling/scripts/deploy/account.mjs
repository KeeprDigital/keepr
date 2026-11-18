/**
 * The Cloudflare account a deploy reaches (ADR-0130). Each Environment's
 * Wrangler configs name its account: the top level production's, an `env`
 * block another Environment's, which a block that names none inherits.
 * Wrangler prefers the config's `account_id` to an exported
 * `CLOUDFLARE_ACCOUNT_ID`, so an export that disagrees is ignored by Wrangler
 * and means the operator aimed at another account than the deploy would
 * reach: the deploy refuses it, before building anything.
 *
 * A Release whose configs name no account, from before this, deploys to the
 * exported account, or to the one the API token reaches.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseJsonc } from '../jsonc.mjs';
import { resolveWranglerConfig } from './fingerprint.mjs';

export const ACCOUNT_ID_ENV = 'CLOUDFLARE_ACCOUNT_ID';

/**
 * @param {{
 *   release: {
 *     app: string,
 *     appDir: string,
 *     descriptor: Pick<import('./release.mjs').Descriptor, 'worker' | 'environments' | 'parts'>,
 *   },
 *   environment: string,
 *   env: Record<string, string | undefined>,
 * }} options
 */
export function refuseAccountMismatch({ release: { app, appDir, descriptor }, environment, env }) {
	const exported = env[ACCOUNT_ID_ENV]?.trim();
	if (!exported) return;
	const wranglerEnv = descriptor.environments[environment]?.wranglerEnv;
	for (const config of [
		descriptor.worker.source,
		...Object.values(descriptor.parts).map((part) => part.config),
	]) {
		const named = resolveWranglerConfig(
			parseJsonc(readFileSync(join(appDir, config), 'utf8')),
			wranglerEnv,
		).account_id;
		if (named !== undefined && named !== exported)
			throw new Error(
				`Refusing to deploy ${app}: ${config} names another account for ${environment} than ${ACCOUNT_ID_ENV}. Wrangler deploys to the config's; unset ${ACCOUNT_ID_ENV}.`,
			);
	}
}
