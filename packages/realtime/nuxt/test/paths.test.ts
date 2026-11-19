import { describe, expect, it } from 'vitest';
import { assertRealtimePaths } from '../build/paths.ts';

describe('the paths an app states', () => {
	it.each([
		['the defaults', '/realtime/socket', '/realtime/port'],
		// Nothing but the dev proxy's prefix rule ties one to the other.
		["a port above the socket's path", '/api/realtime/socket', '/api/realtime'],
	])('accepts %s', (_what, socketPath, portPath) => {
		expect(() => assertRealtimePaths({ socketPath, portPath })).not.toThrow();
	});

	it.each([
		// The dev proxy matches by prefix, as a string: each of these would be sent to the dev Worker.
		['a port under the socket', '/realtime', '/realtime/port', /starts with realtime\.socketPath/],
		['a port that only starts like the socket', '/realtime', '/realtime-port', /starts with/],
		['the socket itself', '/realtime', '/realtime', /starts with/],
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
	])('refuses %s', (_what, socketPath, portPath, message) => {
		expect(() => assertRealtimePaths({ socketPath, portPath })).toThrow(message);
	});
});
