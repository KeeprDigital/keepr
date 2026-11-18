import { readFileSync } from 'node:fs';
import { unstable_readConfig } from 'wrangler';
import { describeWranglerEnvironments } from '@keepr/nuxt-layer/test/helpers/wranglerEnvironments';
import { parseJsonc } from '@keepr/tooling/scripts/jsonc.mjs';

const descriptor = parseJsonc(readFileSync('deploy.jsonc', 'utf8')) as {
	environments: Record<string, { url: string; wranglerEnv?: string }>;
	parts: Record<string, { config: string }>;
};

describeWranglerEnvironments({
	descriptor,
	readConfig: unstable_readConfig,
	workers: [
		// Nitro names the app's Worker in the built config; its env block names it itself.
		{ config: 'wrangler.jsonc', name: 'stream' },
		{ config: descriptor.parts.validator!.config, name: 'stream-silent-video-validator' },
	],
});
