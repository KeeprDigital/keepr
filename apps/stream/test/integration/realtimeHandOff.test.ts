import { CLOSE_REFUSED } from '@keepr/realtime/protocol';
import { beforeAll, describe, expect, it } from 'vitest';
import { fetch, operatorSessionCookie, url } from './client';

/**
 * Stream Keepr takes realtime's layer (ADR-0138). The hand-off's rules are
 * tested at their home, `packages/realtime/nuxt/test`; this is the wiring: the
 * dev server holds the socket's path, and Stream Keepr's port answers it.
 *
 * The port lets nobody in until a Session and a Screen Output are authorized
 * (#1315), so the answer a signed-in operator gets is the refusal.
 */

let cookie = '';

beforeAll(async () => {
	cookie = await operatorSessionCookie();
});

describe("realtime's socket", () => {
	it('is refused by a close a page can read', async () => {
		const socket = new WebSocket(url('/realtime/socket').replace('http', 'ws'), {
			headers: { cookie },
		} as never);
		const closed = await new Promise<{ opened: boolean; code: number }>((resolve) => {
			let opened = false;
			socket.addEventListener('open', () => (opened = true));
			socket.addEventListener('close', ({ code }) => resolve({ opened, code }));
		});

		expect(closed).toEqual({ opened: true, code: CLOSE_REFUSED });
	});

	it('answers its port to no request from outside', async () => {
		const response = await fetch('/realtime/port');

		expect(response.status).toBe(404);
	});
});
