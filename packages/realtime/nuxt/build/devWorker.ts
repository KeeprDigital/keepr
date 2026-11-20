import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { HAND_OFF_HEADER } from '../server/worker/headers.ts';

/**
 * Starts the Worker beside `nuxt dev` (`../server/worker/dev.ts`), from the
 * dev server's own process, so whatever starts `nuxt dev` starts it and
 * whatever stops one stops the other.
 */

/** The name the app's dev binding reaches the Worker by (`script_name`). */
export const DEV_WORKER_NAME = 'keepr-realtime-dev';

export interface DevWorker {
	/** Where it listens, on a port of its own choosing: the dev proxy's target. */
	readonly url: string;
	/** Say where the dev server listens, once it does: the port is asked there. */
	appListensAt(origin: string): void;
	stop(): Promise<void>;
}

/**
 * Wrangler's local registry is how a `script_name` binding finds its Worker,
 * and it is one directory for the whole machine, keyed by the Worker's name.
 * Two dev servers running at once, in two worktrees or in one integration
 * run, would each find whichever Worker registered last. So a dev server keeps
 * a registry of its own, which the bindings Nitro makes read as well: they are
 * made in this process's threads, after this.
 *
 * It is a directory under the app's `.wrangler`, named for the dev server's
 * build directory, which no two running dev servers share. A run that was
 * killed leaves nothing to collect: the next one takes the same directory.
 *
 * A registry already named is left alone: whoever named it runs the Workers
 * this dev server binds, and owns the names in it.
 */
export function devRegistry({ rootDir, buildDir }: { rootDir: string; buildDir: string }): string {
	const named = process.env.WRANGLER_REGISTRY_PATH;
	if (named) return named;
	const server = createHash('sha256').update(buildDir).digest('hex').slice(0, 12);
	const registry = join(rootDir, '.wrangler', 'realtime-registry', server);
	mkdirSync(registry, { recursive: true });
	process.env.WRANGLER_REGISTRY_PATH = registry;
	return registry;
}

/** The signals a dev server shuts itself down on: it runs each `close` hook, then exits. */
const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM'] as const;

/**
 * Run `start`, and take off this process whatever it made listen for a
 * shutdown signal.
 *
 * Miniflare, which runs the Worker, listens for both in the process it is
 * started in, and its listener ends that process at once. The dev server's own
 * shutdown is then cut off before a `close` hook has run: the Worker is never
 * stopped by `stop`, and the `workerd` of Nitro's bindings, which only Nitro's
 * `close` stops, is left running with no parent. So the signal stays the dev
 * server's, whose shutdown stops the Worker (`stop`). Miniflare still stops its
 * `workerd` on the process's `exit`, should a shutdown not reach `stop`.
 *
 * Where nothing else listened, there is no shutdown to cut off, and ending the
 * process is right: the listeners stay.
 */
async function leavingShutdownToTheDevServer<T>(start: () => Promise<T>): Promise<T> {
	const before = SHUTDOWN_SIGNALS.map((signal) => [signal, process.listeners(signal)] as const);
	try {
		return await start();
	} finally {
		for (const [signal, listeners] of before) {
			if (listeners.length === 0) continue;
			for (const added of process.listeners(signal))
				if (!listeners.includes(added)) process.removeListener(signal, added);
		}
	}
}

/**
 * Start the Worker and wait until it listens. `secret` marks each request it
 * puts to the app's port, which the port's route requires (`defineRealtimePort`):
 * it is added here, in the dev server's process, and never reaches the Worker.
 */
export async function startDevWorker({
	portPath,
	maxSocketAgeMs,
	secret,
	compatibilityDate,
	registry,
}: {
	portPath: string;
	maxSocketAgeMs: number;
	secret: string;
	compatibilityDate: string;
	registry: string;
}): Promise<DevWorker> {
	// Required, not imported: Nuxt loads a module's files through its own
	// transform, and Wrangler does not survive being loaded through it.
	const { unstable_startWorker } = createRequire(import.meta.url)(
		'wrangler',
	) as typeof import('wrangler');
	let appOrigin: string | undefined;

	const { worker, url } = await leavingShutdownToTheDevServer(async () => {
		const started = await unstable_startWorker({
			name: DEV_WORKER_NAME,
			entrypoint: fileURLToPath(new URL('../server/worker/dev.ts', import.meta.url)),
			compatibilityDate,
			bindings: {
				OBJECT: { type: 'durable_object_namespace', class_name: 'RealtimeObject' },
				PORT_PATH: { type: 'plain_text', value: portPath },
				MAX_SOCKET_AGE_MS: { type: 'plain_text', value: String(maxSocketAgeMs) },
				// The dev server, asked over the loopback at the address it listens on. The
				// caller's host goes with the request, so the app's port compares an
				// `Origin` with what the page sees, as the built Worker's does.
				APP: {
					type: 'fetcher',
					fetcher: async (asked: { url: string; headers: Iterable<[string, string]> }) => {
						if (appOrigin === undefined)
							return new Response('The dev server is not listening yet.', { status: 503 });
						const { host, pathname, search } = new URL(asked.url);
						const headers = new Headers([...asked.headers]);
						headers.set('host', host);
						headers.set(HAND_OFF_HEADER, secret);
						return fetch(new URL(pathname + search, appOrigin), { headers, redirect: 'manual' });
					},
				},
			},
			migrations: [{ tag: 'v1', new_sqlite_classes: ['RealtimeObject'] }],
			dev: {
				server: { hostname: '127.0.0.1', port: 0 },
				inspector: false,
				registry,
				// Each run starts from empty storage: a page that held a sequence is told
				// continuity was lost, by the object's epoch, and reads again.
				persist: false,
				watch: false,
				liveReload: false,
				logLevel: 'warn',
			},
		});
		await started.ready;
		return { worker: started, url: await started.url };
	});

	return {
		url: url.origin,
		appListensAt(origin) {
			appOrigin = origin;
		},
		stop: () => worker.dispose(),
	};
}
