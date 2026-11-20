/** The two paths an app states, or leaves at their defaults (`../module.ts`). */
export interface RealtimePaths {
	socketPath: string;
	portPath: string;
}

/**
 * Where, under `nuxt dev`, a request for the socket's path is sent on to the
 * dev Worker. Nitro's dev proxy takes every path that starts with its route,
 * as a string, so its route is this one, which no app's route shares, and the
 * socket's own path is rewritten to it (`devProxyUrl`). A route that only
 * starts with the socket's path stays the app's.
 */
export const DEV_PROXY_ROUTE = '/__keepr_realtime_socket';

/**
 * The paths as the hand-off can serve them, or an error that names what is
 * wrong. The port is not the socket: under `nuxt dev` the dev Worker's
 * question would come back to itself.
 */
export function assertRealtimePaths({ socketPath, portPath }: RealtimePaths): void {
	for (const [name, path] of Object.entries({ socketPath, portPath }))
		if (!/^\/[^?#]+$/.test(path) || path.startsWith(DEV_PROXY_ROUTE))
			throw new Error(`realtime.${name} is a path from the root, not ${JSON.stringify(path)}.`);
	if (portPath === socketPath)
		throw new Error(
			`realtime.portPath is realtime.socketPath (${socketPath}): the port's question would be taken for a socket.`,
		);
}

/**
 * The URL a request to the dev server goes on with: one for the socket's path
 * itself, and nothing else, is sent to the dev Worker by Nitro's dev proxy,
 * its query kept. Every other URL is the app's, unchanged.
 */
export function devProxyUrl(url: string, socketPath: string): string {
	const query = url.indexOf('?');
	const path = query === -1 ? url : url.slice(0, query);
	if (path !== socketPath) return url;
	return `${DEV_PROXY_ROUTE}${query === -1 ? '' : url.slice(query)}`;
}
