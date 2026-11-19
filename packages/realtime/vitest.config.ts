import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		// The object and the client transport, then the Nuxt layer on its fixture app.
		include: ['test/**/*.test.ts', 'nuxt/test/**/*.test.ts'],
		exclude: ['**/node_modules/**', 'nuxt/test/fixture/**'],
		environment: 'node',
	},
});
