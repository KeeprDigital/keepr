/**
 * The Worker beside `nuxt dev` (ADR-0137). The dev server runs in Node and
 * cannot hold a Durable Object, so this holds the class: Nitro's dev proxy
 * sends the socket's path here, and the app's dev binding names this Worker
 * (`script_name`), so the server publishes to the same objects by RPC.
 *
 * It hands off as the built Worker's entry does. `APP` is the dev server,
 * which answers the port (`../../build/devWorker.ts`). Never deployed: only
 * `nuxt dev` starts it.
 */
import { handSocket } from './handOff.ts';
import { RealtimeObject as BaseRealtimeObject } from '../../../src/object/index.ts';

interface Bindings {
	OBJECT: DurableObjectNamespace<RealtimeObject>;
	APP: Fetcher;
	PORT_PATH: string;
	/** The app's `realtime.maxSocketAgeMs`. */
	MAX_SOCKET_AGE_MS: string;
}

/** The object's class at the options the app states under `realtime`, as the built Worker's is. */
export class RealtimeObject extends BaseRealtimeObject<Bindings> {
	constructor(ctx: DurableObjectState, env: Bindings) {
		super(ctx, env, { maxAgeMs: Number(env.MAX_SOCKET_AGE_MS) });
	}
}

export default {
	async fetch(request: Request, env: Bindings): Promise<Response> {
		// The dev proxy strips the socket's path, so the path itself arrives as `/`.
		if (new URL(request.url).pathname !== '/') return new Response('Not found', { status: 404 });
		return handSocket(request, {
			namespace: env.OBJECT,
			binding: 'OBJECT',
			portPath: env.PORT_PATH,
			ask: (asked) => env.APP.fetch(asked),
		});
	},
} satisfies ExportedHandler<Bindings>;
