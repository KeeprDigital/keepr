import { defineConfig } from 'vitest/config';
import {
	blockCloudflareCredentialsSetup,
	LOAD_TOLERANT_HOOK_TIMEOUT_MS,
	LOAD_TOLERANT_TEST_TIMEOUT_MS,
	loadTolerantWaitsSetup,
	nitroH3Directory,
} from '@keepr/nuxt-layer/vitest.shared.ts';
import { rerunTriggers } from '@keepr/tooling/scripts/rerun-triggers.mjs';

// What runs without a Nuxt app: the server routes. The layer's settings, as its own unit config has them.
export default defineConfig({
	resolve: {
		alias: { h3: nitroH3Directory },
	},
	test: {
		name: 'unit',
		include: ['test/unit/**/*.test.ts'],
		environment: 'node',
		setupFiles: [blockCloudflareCredentialsSetup, loadTolerantWaitsSetup],
		testTimeout: LOAD_TOLERANT_TEST_TIMEOUT_MS,
		hookTimeout: LOAD_TOLERANT_HOOK_TIMEOUT_MS,
		restoreMocks: true,
		clearMocks: true,
		// Vitest's own, held to this app and the packages it consumes (`verify:quick`, ADR-0148).
		forceRerunTriggers: rerunTriggers('@keepr/score', [
			'**/package.json',
			'**/{vitest,vite}.config.*',
		]),
	},
});
