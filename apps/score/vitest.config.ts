import { defineVitestConfig } from '@nuxt/test-utils/config';

export default defineVitestConfig({
	test: {
		include: ['test/**/*.test.ts'],
		environment: 'nuxt',
		execArgv: ['--no-experimental-webstorage'],
		// On by default since Vitest 5. A warm cache replays the test-utils app entry
		// without resolving its relative imports, so every file fails.
		fsModuleCache: false,
		restoreMocks: true,
		clearMocks: true,
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
