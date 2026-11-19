/**
 * The built Worker's entry (ADR-0137, ADR-0138). Nitro's own entry exports only
 * `default`, and a route cannot hand back an object's `101`, so this wraps it:
 * it exports the object's class for the app's binding, hands an upgrade on the
 * socket's path to the object after asking the app's port, and leaves every
 * other request to Nitro.
 *
 * Only a production build takes it (`../../module.ts`): under `nuxt dev` it
 * would replace Nitro's dev entry, and the Worker beside the dev server
 * (`./dev.ts`) hands off instead.
 */
import nitroHandler from 'nitropack/presets/cloudflare/runtime/cloudflare-module';
import { useRuntimeConfig } from 'nitropack/runtime';
import { handSocket } from './handOff.ts';
import type { ScopeNamespace } from './handOff.ts';
import { markHandOff } from './mark.ts';

export { RealtimeObject } from '../../../src/object/index.ts';

type Bindings = Record<string, unknown>;
/** Nitro types its handler by a package this workspace does not install, so it arrives untyped. */
const nitro: ExportedHandler<Bindings> = nitroHandler;

export default {
	...nitro,
	async fetch(request, env, context): Promise<Response> {
		const toNitro = async (asked: Request): Promise<Response> =>
			nitro.fetch!(asked as Parameters<NonNullable<typeof nitro.fetch>>[0], env, context);
		const { binding, socketPath, portPath } = useRuntimeConfig().realtime;
		if (new URL(request.url).pathname !== socketPath) return toNitro(request);
		return handSocket(request, {
			namespace: env[binding] as ScopeNamespace,
			portPath,
			// Through Nitro, as a request like any other, so the app's middleware and
			// its route answer it. The mark is what lets the port answer this one.
			ask: (asked) => toNitro(markHandOff(asked)),
		});
	},
} satisfies ExportedHandler<Bindings>;
