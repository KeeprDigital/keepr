// Named as every App binds it, so the real Keepr Accounts and a local stand-in
// are the same service to an App (#1256).
const workerName = 'keepr-accounts';

// Everything an app of this workspace starts from is the layer's (ADR-0093).
export default defineNuxtConfig({
	extends: ['@keepr/nuxt-layer'],

	css: ['~/assets/css/main.css'],

	runtimeConfig: {
		// The sign-in secret, which only Keepr Accounts holds (ADR-0112).
		betterAuthSecret: '',
	},

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
