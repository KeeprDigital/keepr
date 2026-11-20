import { describe, expect, it } from 'vitest';
import { assertRealtimePaths, DEV_PROXY_ROUTE, devProxyUrl } from '../build/paths.ts';

describe('the paths an app states', () => {
	it.each([
		['the defaults', '/realtime/socket', '/realtime/port'],
		["a port above the socket's path", '/api/realtime/socket', '/api/realtime'],
		// The dev proxy takes the socket's path alone, so a port beside it is the app's.
		['a port under the socket', '/realtime', '/realtime/port'],
		['a port that only starts like the socket', '/realtime', '/realtime-port'],
	])('accepts %s', (_what, socketPath, portPath) => {
		expect(() => assertRealtimePaths({ socketPath, portPath })).not.toThrow();
	});

	it.each([
		['the socket itself', '/realtime', '/realtime', /realtime\.portPath is realtime\.socketPath/],
		[
			'a path not from the root',
			'realtime/socket',
			'/realtime/port',
			/realtime\.socketPath is a path/,
		],
		[
			'a path with a query',
			'/realtime/socket',
			'/realtime/port?as=me',
			/realtime\.portPath is a path/,
		],
		['the root', '/', '/realtime/port', /realtime\.socketPath is a path/],
		[
			"the dev proxy's own route",
			`${DEV_PROXY_ROUTE}/socket`,
			'/realtime/port',
			/realtime\.socketPath is a path/,
		],
	])('refuses %s', (_what, socketPath, portPath, message) => {
		expect(() => assertRealtimePaths({ socketPath, portPath })).toThrow(message);
	});
});

// Under `nuxt dev`: the socket's path, and no route that shares its prefix.
describe('what the dev proxy sends to the dev Worker', () => {
	it.each([
		{ url: '/realtime/socket?room=1', to: `${DEV_PROXY_ROUTE}?room=1` },
		{ url: '/realtime/socket', to: DEV_PROXY_ROUTE },
		{ url: '/realtime/socket/status', to: '/realtime/socket/status' },
		{ url: '/realtime/sockets?room=1', to: '/realtime/sockets?room=1' },
		{ url: '/realtime/port?room=1', to: '/realtime/port?room=1' },
	])('takes $url as $to', ({ url, to }) => {
		expect(devProxyUrl(url, '/realtime/socket')).toBe(to);
	});
});
