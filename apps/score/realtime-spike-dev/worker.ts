/**
 * Throwaway for #1295: the Worker that runs beside `nuxt dev`, which cannot hold
 * a Durable Object itself. It holds the class, and takes the upgrade Nitro's
 * dev proxy forwards: it asks the app who the caller is, as the built Worker's
 * entry does, then hands the socket to the object.
 */
export { EventRealtime } from '../../stream/prototypes/realtime-do/worker';

interface Env {
	EVENT_REALTIME: DurableObjectNamespace;
	APP_ORIGIN: string;
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		if (request.headers.get('upgrade') !== 'websocket') return new Response(null, { status: 404 });
		const { search } = new URL(request.url);
		const grant = await fetch(new URL(`/realtime-spike/authorize${search}`, env.APP_ORIGIN), {
			headers: { cookie: request.headers.get('cookie') ?? '' },
		});
		if (!grant.ok) return new Response(null, { status: grant.status });
		const { scope } = (await grant.json()) as { scope: string };
		return env.EVENT_REALTIME.getByName(scope).fetch(request);
	},
};
