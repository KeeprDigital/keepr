import { defineVitestConfig } from '@nuxt/test-utils/config';
import { defineConfig } from 'vitest/config';
import {
	blockCloudflareCredentialsSetup,
	LOAD_TOLERANT_HOOK_TIMEOUT_MS,
	LOAD_TOLERANT_TEST_TIMEOUT_MS,
	loadTolerantWaitsSetup,
	quietSuspenseNoticeSetup,
} from '@keepr/nuxt-layer/vitest.shared.ts';
import { rerunTriggers } from '@keepr/tooling/scripts/rerun-triggers.mjs';

// What needs a Nuxt app around it: the pages. The layer's settings, as its own Nuxt config has them.
const nuxtVitestConfig = defineVitestConfig({
	test: {
		name: 'nuxt',
		include: ['test/nuxt/**/*.test.ts'],
		environment: 'nuxt',
		execArgv: ['--no-experimental-webstorage'],
		// On by default since Vitest 5. A warm cache replays the test-utils app entry
		// without resolving its relative imports, so every file fails.
		fsModuleCache: false,
		testTimeout: LOAD_TOLERANT_TEST_TIMEOUT_MS,
		hookTimeout: LOAD_TOLERANT_HOOK_TIMEOUT_MS,
		restoreMocks: true,
		clearMocks: true,
		// Vitest's own, held to this app and the packages it consumes (`verify:quick`, ADR-0148).
		forceRerunTriggers: rerunTriggers('@keepr/score', [
			'**/package.json',
			'**/{vitest,vite}.config.*',
			'**/vitest.nuxt.config.ts',
			'**/nuxt.config.ts',
		]),
		environmentOptions: {
			nuxt: {
				domEnvironment: 'happy-dom',
				// Its own build directory: in `.nuxt` the config-time build would race
				// `nuxt prepare`, the lint and the typecheck when they run side by side.
				overrides: {
					buildDir: 'node_modules/.cache/nuxt-vitest',
				},
			},
		},
	},
});

export default defineConfig(async (env) => {
	const config = await nuxtVitestConfig(env);
	// Ahead of the test-utils entry, which `defineVitestConfig` puts first and
	// which mounts the app that prints Vue's Suspense notice.
	config.test!.setupFiles = [
		blockCloudflareCredentialsSetup,
		loadTolerantWaitsSetup,
		quietSuspenseNoticeSetup,
		...[config.test!.setupFiles ?? []].flat(),
	];
	return config;
});
