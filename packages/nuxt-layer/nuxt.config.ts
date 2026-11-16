import { fileURLToPath } from 'node:url';

/**
 * What every Keepr app is before it is anything else (ADR-0093): a client-rendered
 * Nuxt app with Nuxt UI, served by a Cloudflare Worker. An app extends this and adds
 * only its own. Anything else two apps share joins this layer when the second app
 * needs it, in the change that moves the first app onto it.
 */
export default defineNuxtConfig({
	ssr: false,

	modules: ['@nuxt/ui'],

	// A layer's own files are named by where they are: `~` is the app that extends it.
	css: [fileURLToPath(new URL('./app/assets/css/base.css', import.meta.url))],

	// `fallback` is what the page is when no system preference can be read at all.
	colorMode: {
		preference: 'system',
		fallback: 'dark',
	},

	nitro: {
		preset: 'cloudflare_module',
		cloudflare: {
			deployConfig: true,
			nodeCompat: true,
		},
	},

	typescript: {
		strict: true,
	},

	devtools: {
		enabled: false,
	},

	compatibilityDate: '2026-07-16',
});
