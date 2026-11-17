import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import {
	blockCloudflareCredentialsSetup,
	LOAD_TOLERANT_HOOK_TIMEOUT_MS,
	LOAD_TOLERANT_TEST_TIMEOUT_MS,
	loadTolerantWaitsSetup,
	nitroH3Directory,
} from '@keepr/nuxt-layer/vitest.shared.ts';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// The server, request in and response out, with no Nuxt app around it.
export default defineConfig({
	resolve: {
		alias: { h3: nitroH3Directory, '~~': here('.'), '~': here('./app') },
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
