import { defineConfig } from 'vitest/config';
import {
	blockCloudflareCredentialsSetup,
	LOAD_TOLERANT_HOOK_TIMEOUT_MS,
	LOAD_TOLERANT_TEST_TIMEOUT_MS,
	loadTolerantWaitsSetup,
	nitroH3Directory,
} from './vitest.shared.ts';

// What runs without a Nuxt app: the server and shared foundation.
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
	},
});
