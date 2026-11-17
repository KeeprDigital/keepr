import { defineConfig } from 'vitest/config';
import { nitroH3Directory } from '@keepr/nuxt-layer/vitest.shared.ts';

// The stand-in, request in and response out, read by the layer's own identity function.
export default defineConfig({
	resolve: {
		alias: { h3: nitroH3Directory },
	},
	test: {
		include: ['test/**/*.test.ts'],
		environment: 'node',
	},
});
