import type { AddressInfo } from 'node:net';
import { createServer } from 'node:http';
import { createApp, createError, eventHandler, toNodeListener } from 'h3';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createFakeNitroApp, installNitroPlugin } from '@keepr/nuxt-layer/test/helpers/nitroApp';
import { writeTimingOf } from '~~/server/utils/writeTiming';

// The timing plugin's hooks, fired as Nitro fires them: its h3 app calls
// `request` as each request arrives and `afterResponse` once it is answered,
// a route that threw included (`nitropack/dist/runtime/internal/app.mjs`).

vi.stubGlobal('defineNitroPlugin', (plugin: unknown) => plugin);

const nitroApp = createFakeNitroApp();
installNitroPlugin((await import('~~/server/plugins/write-timing')).default, nitroApp);

/** A write that calls its Event's object once, then answers, or throws `status`. */
const app = createApp({
	onRequest: async (event) => await nitroApp.hooks.callHook('request', event),
	onAfterResponse: async (event) => await nitroApp.hooks.callHook('afterResponse', event),
});
app.use(
	eventHandler(async (event) => {
		await writeTimingOf(event)?.time('publish', async () => {});
		const status = Number(new URL(event.path, 'http://x').searchParams.get('throw'));
		if (status) throw createError({ statusCode: status });
		return { ok: true };
	}),
);

const server = createServer(toNodeListener(app));
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
afterAll(() => new Promise((resolve) => server.close(resolve)));

describe('the write timing plugin', () => {
	it.each([
		['answers', '', 200],
		['throws', '?throw=409', 409],
	])('logs one line for a write that %s, with its status', async (_case, query, statusCode) => {
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});

		await fetch(`${origin}/api/events/3/screens/7/command${query}`, { method: 'POST' });

		const lines = log.mock.calls
			.map(([line]) => line as { message?: string; statusCode?: number })
			.filter((line) => line?.message === 'realtime_write_timed');
		expect(lines).toEqual([expect.objectContaining({ statusCode, publishCalls: 1 })]);
		log.mockRestore();
	});
});
