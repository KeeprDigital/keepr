import { defineConfig } from 'vitest/config';

// These spawn Git, Node and SQLite: bounds that detect a hang, not a speed budget.
export default defineConfig({
	test: {
		include: ['test/**/*.test.ts'],
		environment: 'node',
		testTimeout: 60_000,
		hookTimeout: 120_000,
		restoreMocks: true,
		// The deploy tooling's tests must not be able to reach Cloudflare.
		setupFiles: ['test/helpers/blockCloudflareCredentials.ts'],
	},
});
