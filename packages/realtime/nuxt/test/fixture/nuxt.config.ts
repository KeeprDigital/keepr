import process from 'node:process';

/**
 * An app as the layer's tests need one (ADR-0138): it takes the layer as any
 * app does, and its port lets a socket in. Never deployed.
 */
export default defineNuxtConfig({
	extends: ['@keepr/realtime/nuxt'],

	// Two dev servers at once each build into a directory of their own (`../servers.ts`).
	...(process.env.REALTIME_FIXTURE_BUILD_DIR
		? { buildDir: process.env.REALTIME_FIXTURE_BUILD_DIR }
		: {}),

	ssr: false,

	nitro: {
		preset: 'cloudflare_module',
		cloudflare: {
			deployConfig: true,
			nodeCompat: true,
			wrangler: { name: 'realtime-fixture' },
			dev: { configPath: 'wrangler.dev.jsonc' },
		},
	},

	devtools: { enabled: false },

	compatibilityDate: '2026-07-16',
});
