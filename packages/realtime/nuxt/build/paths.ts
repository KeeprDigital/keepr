/** The two paths an app states, or leaves at their defaults (`../module.ts`). */
export interface RealtimePaths {
	socketPath: string;
	portPath: string;
}

/**
 * The paths as the hand-off can serve them, or an error that names what is
 * wrong. Nitro's dev proxy takes every path that starts with the socket's, as
 * a string, so a port's path that starts with it would never reach the app
 * under `nuxt dev`: the dev Worker's question would come back to itself.
 */
export function assertRealtimePaths({ socketPath, portPath }: RealtimePaths): void {
	for (const [name, path] of Object.entries({ socketPath, portPath }))
		if (!/^\/[^?#]+$/.test(path))
			throw new Error(`realtime.${name} is a path from the root, not ${JSON.stringify(path)}.`);
	if (portPath.startsWith(socketPath))
		throw new Error(
			`realtime.portPath (${portPath}) starts with realtime.socketPath (${socketPath}): under nuxt dev the proxy would take the port's requests for the socket's.`,
		);
}
