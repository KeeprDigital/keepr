import { describe, expect, it } from 'vitest';

import { checkOnPageEvents } from '../../src/client/index.ts';
import type { PageLike } from '../../src/client/index.ts';
import { rig, settle } from './helpers/rig.ts';

/** A page as the helper sees one: a window with its document, and a way to fire their events. */
function fakePage(visibilityState: string) {
	const listeners = new Map<string, Set<() => void>>();
	const target = {
		addEventListener(type: string, listener: () => void) {
			listeners.set(type, (listeners.get(type) ?? new Set()).add(listener));
		},
		removeEventListener(type: string, listener: () => void) {
			listeners.get(type)?.delete(listener);
		},
	};
	const page: PageLike = { ...target, document: { ...target, visibilityState } };
	return {
		page,
		fire(type: string) {
			for (const listener of [...(listeners.get(type) ?? [])]) listener();
		},
	};
}

/** A transport waiting out the time before its next retry, having opened one socket. */
async function waiting() {
	const held = rig();
	held.transport.onMessage('a', 'note', () => {});
	(await held.socket()).drop();
	return held;
}

describe('checkOnPageEvents', () => {
	it.each([
		{ event: 'online', visibilityState: 'visible', sockets: 2 },
		{ event: 'visibilitychange', visibilityState: 'visible', sockets: 2 },
		{ event: 'visibilitychange', visibilityState: 'hidden', sockets: 1 },
	])(
		'on $event of a $visibilityState page, leaves the transport with $sockets socket(s) opened',
		async (row) => {
			const { transport, sockets } = await waiting();
			const { page, fire } = fakePage(row.visibilityState);
			checkOnPageEvents(transport, page);

			fire(row.event);
			await settle();

			expect(sockets).toHaveLength(row.sockets);
		},
	);

	it('stops listening when its disposer is called', async () => {
		const { transport, sockets } = await waiting();
		const { page, fire } = fakePage('visible');

		checkOnPageEvents(transport, page)();
		fire('online');
		fire('visibilitychange');
		await settle();

		expect(sockets).toHaveLength(1);
	});

	it('is inert where there is no page, as under Node', async () => {
		const { transport, sockets } = await waiting();

		const stop = checkOnPageEvents(transport);
		stop();
		await settle();

		expect(sockets).toHaveLength(1);
	});
});
