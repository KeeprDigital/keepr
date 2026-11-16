import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export {
	LOAD_TOLERANT_BAIL_AFTER_FAILURES,
	LOAD_TOLERANT_HOOK_TIMEOUT_MS,
	LOAD_TOLERANT_TEST_TIMEOUT_MS,
} from './test/helpers/loadTolerantBounds.ts';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/**
 * Setup files an app's Vitest configs name, by where they are: a config's own
 * relative path is the app's. Each file says what it sets up.
 */
export const blockCloudflareCredentialsSetup = here('./test/helpers/blockCloudflareCredentials.ts');
export const loadTolerantWaitsSetup = here('./test/helpers/loadTolerantWaits.ts');
export const quietSuspenseNoticeSetup = here('./test/nuxt/quietSuspenseNotice.ts');

/**
 * The h3 that Nitro runs on, resolved the way Nuxt resolves it. The Nitro
 * build and the generated tsconfig both alias `h3` to this copy, so server code
 * never sees whichever h3 pnpm happens to hoist; outside Nuxt, a plain vitest
 * run would, and a dependency hoisting h3 v2 (as `@nuxt/fonts` 1 does) would
 * test server code against a major version it never runs on.
 */
const requireFromNuxt = createRequire(createRequire(import.meta.url).resolve('nuxt/package.json'));
const requireFromNitroServer = createRequire(
	requireFromNuxt.resolve('@nuxt/nitro-server/package.json'),
);
export const nitroH3Directory = dirname(requireFromNitroServer.resolve('h3/package.json'));
