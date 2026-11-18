import { fileURLToPath } from 'node:url';

const workerName = 'score';

// Everything an app of this workspace starts from is the layer's (ADR-0093).
export default defineNuxtConfig({
	extends: ['@keepr/nuxt-layer'],

	css: ['~/assets/css/main.css'],

	// Throwaway for #1295. Only the built Worker: set for `nuxt dev` as well, it
	// replaces Nitro's dev entry and the dev server never comes up.
	$production: {
		nitro: { entry: fileURLToPath(new URL('./server/worker-entry.ts', import.meta.url)) },
	},

	// Throwaway for #1295. `nuxt dev` binds the object in the Worker beside it and
	// proxies the socket there, so the page uses one path in dev and when built.
	$development: {
		nitro: {
			cloudflare: { dev: { environment: 'dev' } },
			devProxy: {
				'/realtime-spike/connect': { target: 'http://127.0.0.1:8912/connect', ws: true },
			},
		},
	},

	nitro: {
		cloudflare: {
			wrangler: {
				name: workerName,
			},
		},
	},
});
