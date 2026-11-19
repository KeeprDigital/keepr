import { readFileSync } from 'node:fs';
import { unstable_readConfig } from 'wrangler';
import { describeWranglerEnvironments } from '@keepr/nuxt-layer/test/helpers/wranglerEnvironments';
import { parseJsonc } from '@keepr/tooling/scripts/jsonc.mjs';

describeWranglerEnvironments({
	descriptor: parseJsonc(readFileSync('deploy.jsonc', 'utf8')),
	readConfig: unstable_readConfig,
	// Nitro names the Worker in the built config (nuxt.config.ts); its env block names it itself.
	workers: [{ config: 'wrangler.jsonc', name: 'keepr-accounts' }],
});
