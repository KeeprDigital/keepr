/**
 * Throwaway for #1295: the Worker's entry, wrapping Nitro's own so it can
 * export a Durable Object class and hand a WebSocket upgrade to it.
 *
 * The upgrade is authorized by an ordinary route, asked through Nitro's own
 * handler, so who may hear what stays where a Session would be checked.
 */
import nitroHandler from 'nitropack/presets/cloudflare/runtime/cloudflare-module';

export { EventRealtime } from '../prototypes/realtime-do/worker';

interface Env {
	EVENT_REALTIME: DurableObjectNamespace;
}

const CONNECT_PATH = '/realtime-spike/connect';
const AUTHORIZE_PATH = '/realtime-spike/authorize';

export default {
	...nitroHandler,
	async fetch(request: Request, env: Env, context: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname !== CONNECT_PATH || request.headers.get('upgrade') !== 'websocket')
			return nitroHandler.fetch(request, env, context);

		// Ask the app who this is and what it may hear: the same request, minus
		// the upgrade, to a route like any other.
		const headers = new Headers(request.headers);
		headers.delete('upgrade');
		headers.delete('connection');
		const asked = new URL(AUTHORIZE_PATH + url.search, url);
		const grant = await nitroHandler.fetch(new Request(asked, { headers }), env, context);
		if (!grant.ok) return new Response(null, { status: grant.status });
		const { scope } = (await grant.json()) as { scope: string };

		return env.EVENT_REALTIME.getByName(scope).fetch(request);
	},
};
