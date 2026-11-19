import { expect, it, vi } from 'vitest';

import { createSocketTransport } from '../../src/client/index.ts';

// With nothing injected the transport uses the runtime's own WebSocket and timers: Node's
// here. Nothing listens on the port, so each connect fails and the real timer retries it.
it('connects and retries on the WebSocket and timers of its runtime when given none', async () => {
	let asks = 0;
	const transport = createSocketTransport({
		address: () => {
			asks += 1;
			return 'ws://127.0.0.1:9/';
		},
	});
	try {
		transport.onMessage('a', 'note', () => {});

		await vi.waitFor(() => expect(asks).toBeGreaterThanOrEqual(2), { timeout: 5000 });

		expect(transport.connectionState).toBe('disconnected');
		expect(transport.error).toBeInstanceOf(Error);
	} finally {
		transport.dispose();
	}
});
