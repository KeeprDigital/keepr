import type { IncomingMessage, Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { defineNuxtModule } from 'nuxt/kit';
import { devRegistry, startDevWorker } from './build/devWorker';
import { DEFAULT_MAX_AGE_MS } from '../src/object/limits.ts';
import { assertRealtimePaths, DEV_PROXY_ROUTE, devProxyUrl } from './build/paths';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/** What an app states under `realtime` in its `nuxt.config.ts`. Each has a default. */
export interface RealtimeOptions {
	/** The Durable Object binding the app's Wrangler configuration gives the object's class. */
	binding: string;
	/** Where a page opens its socket: one path under `nuxt dev` and in the built Worker. */
	socketPath: string;
	/**
	 * Where the app's own route answers the port (`defineRealtimePort`). Only the
	 * hand-off reaches it. Not `socketPath` itself.
	 */
	portPath: string;
	/**
	 * How long the object keeps a socket before it closes it to have its caller
	 * judged again by the port. An hour, the object's own default.
	 */
	maxSocketAgeMs: number;
}

/** The Workers runtime the dev Worker runs as: the workspace's compatibility date. */
const DEV_WORKER_COMPATIBILITY_DATE = '2026-07-16';

/** Where the dev server answers a request made from its own machine. */
function loopbackOrigin(server: Server, https: boolean): string {
	const address = server.address();
	if (address === null || typeof address === 'string')
		throw new Error('The dev server listens on no port the realtime dev Worker can reach.');
	const ipv6 = address.family === 'IPv6';
	const everywhere = address.address === '::' || address.address === '0.0.0.0';
	const host = everywhere ? (ipv6 ? '::1' : '127.0.0.1') : address.address;
	return `${https ? 'https' : 'http'}://${ipv6 ? `[${host}]` : host}:${address.port}`;
}

/**
 * Realtime's Nuxt glue (ADR-0137, ADR-0138). A production build takes the
 * Worker entry that exports the object's class and hands sockets to it. Under
 * `nuxt dev`, which cannot hold the class, a Worker beside the dev server
 * holds it, and Nitro's dev proxy sends the socket's path there.
 */
export default defineNuxtModule<RealtimeOptions>({
	meta: { name: '@keepr/realtime', configKey: 'realtime' },
	defaults: {
		binding: 'REALTIME',
		socketPath: '/realtime/socket',
		portPath: '/realtime/port',
		maxSocketAgeMs: DEFAULT_MAX_AGE_MS,
	},
	async setup(options, nuxt) {
		assertRealtimePaths(options);
		// What the server reads: the entry, the port's route and the publish helper.
		const runtime = { ...options, handOffSecret: '' };
		nuxt.options.runtimeConfig.realtime = runtime;

		if (!nuxt.options.dev) {
			// Only the built Worker: set under `nuxt dev`, it replaces Nitro's dev entry
			// and the dev server never comes up.
			nuxt.options.nitro.entry = here('./server/worker/entry.ts');
			return;
		}
		// `nuxt prepare` and a typecheck load the app as a dev server and start none.
		if (nuxt.options._prepare) return;

		// Made for this run: only the dev server's own process can mark a request
		// as the hand-off's (`defineRealtimePort`).
		runtime.handOffSecret = randomUUID();
		const worker = await startDevWorker({
			portPath: options.portPath,
			maxSocketAgeMs: options.maxSocketAgeMs,
			secret: runtime.handOffSecret,
			compatibilityDate: DEV_WORKER_COMPATIBILITY_DATE,
			registry: devRegistry(nuxt.options),
		});
		nuxt.options.nitro.devProxy = {
			...nuxt.options.nitro.devProxy,
			[DEV_PROXY_ROUTE]: { target: worker.url, ws: true },
		};
		nuxt.hook('listen', (server, listener: { https?: unknown }) => {
			worker.appListensAt(loopbackOrigin(server, Boolean(listener.https)));
			// Before anything else hears it: the socket's path itself, and no route that
			// only starts like it, goes to the dev proxy's own route.
			const toTheProxy = (request: IncomingMessage): void => {
				request.url = devProxyUrl(request.url ?? '/', options.socketPath);
			};
			server.prependListener('request', toTheProxy);
			server.prependListener('upgrade', toTheProxy);
		});
		nuxt.hook('close', () => worker.stop());
	},
});
