import { fileURLToPath } from 'node:url';
import { buildReleaseIdentity } from './build/releaseIdentity';

// A layer's own files are named from where they are: a relative path in its
// configuration, and `~` in its code, belong to the app that extends it.
const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/**
 * What every Keepr app is built on (ADR-0093): a client-rendered Nuxt app with
 * Nuxt UI, served by a Cloudflare Worker, and the server, client and test
 * foundation the apps share. An app extends this and adds only its own.
 *
 * It registers no route and no middleware. An app's API surface, and the order
 * its middleware runs in, are stated in the app.
 */
export default defineNuxtConfig({
	ssr: false,

	modules: [
		'@nuxt/ui',
		'@vueuse/nuxt',
		// The Release this build is of, which the app serves at `/api/release`
		// (`readReleaseIdentity`), recorded at build time from the extending app.
		(_options, nuxt) => {
			nuxt.options.runtimeConfig.release = buildReleaseIdentity({
				rootDir: nuxt.options.rootDir,
			});
		},
	],

	// `@nuxtjs/color-mode` reads these from Nuxt config and only from here: the
	// same block in an `app.config.ts` is inert. `fallback` is what the
	// pre-hydration script returns when no system preference can be read at all.
	colorMode: {
		preference: 'system',
		fallback: 'dark',
	},

	runtimeConfig: {
		public: {
			// Where `useIdentity` sends a signed-out visitor. Set
			// `NUXT_PUBLIC_KEEPR_ACCOUNTS_ORIGIN` to a local Keepr Accounts run beside an App.
			keeprAccountsOrigin: 'https://accounts.keepr.digital',
		},
	},

	imports: {
		dirs: [here('./app/composables/core'), here('./app/composables/ui')],
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
