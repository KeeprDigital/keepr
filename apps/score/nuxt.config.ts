const workerName = 'score';

// Everything an app of this workspace starts from is the layer's (ADR-0093).
export default defineNuxtConfig({
	extends: ['@keepr/nuxt-layer'],

	css: ['~/assets/css/main.css'],

	nitro: {
		cloudflare: {
			wrangler: {
				name: workerName,
			},
			dev: {
				configPath: 'wrangler.dev.jsonc',
			},
		},
	},
});
