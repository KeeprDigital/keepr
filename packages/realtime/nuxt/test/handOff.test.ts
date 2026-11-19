import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createSocketTransport } from '../../src/client/index.ts';
import type { SocketConstructor, SocketTransport } from '../../src/client/index.ts';
import type { Delivery, PublishAnswer } from '../../src/object/index.ts';
import { HAND_OFF_HEADER } from '../server/worker/headers.ts';
import { buildFixture, startBuiltWorker, startDevServer } from './servers.ts';
import type { FixtureServer } from './servers.ts';

// The layer's whole promise, held on the fixture app each way an app runs: one
// path for the socket, and the same answer from the built Worker and `nuxt dev`.
const SOCKET_PATH = '/realtime/socket';
const PORT_PATH = '/realtime/port';
const START_TIMEOUT_MS = 180_000;
// Real servers on a machine that may be busy: a round trip is quick, but not always.
vi.setConfig({ testTimeout: 30_000 });

async function until(what: string, condition: () => boolean, timeoutMs = 10_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!condition()) {
		if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}

const transports: SocketTransport[] = [];
afterEach(() => {
	for (const transport of transports.splice(0)) transport.dispose();
});

/** What a page of `server`'s own origin sends, signed in as the fixture knows it. */
const page = (server: FixtureServer): Record<string, string> => ({
	cookie: 'caller=ada',
	origin: server.origin,
});

/** A page's socket to `room`, by the client transport, with the headers a browser would send. */
function connect(
	server: FixtureServer,
	room: string,
	headers: Record<string, string> = page(server),
): SocketTransport {
	const Socket = class extends WebSocket {
		constructor(url: string) {
			super(url, { headers } as never);
		}
	} as SocketConstructor;
	const transport = createSocketTransport({
		address: () => `${server.origin.replace('http', 'ws')}${SOCKET_PATH}?room=${room}`,
		WebSocket: Socket,
	});
	transports.push(transport);
	return transport;
}

/** Hear what is `said` on `channel`, once the object has attached it. */
async function hear(transport: SocketTransport, channel: string): Promise<unknown[]> {
	const heard: unknown[] = [];
	let attached = false;
	transport.onceAttached(channel, () => {
		attached = true;
	});
	transport.onMessage(channel, 'said', (data) => heard.push(data));
	await until(`${channel} to attach`, () => attached);
	return heard;
}

/** Publish as the app's server does: its route calls `useRealtimeScope`. */
async function publish(
	server: FixtureServer,
	room: string,
	deliveries: Delivery[],
): Promise<PublishAnswer[]> {
	const response = await fetch(`${server.origin}/publish?room=${room}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(deliveries),
	});
	expect(response.status).toBe(200);
	return (await response.json()) as PublishAnswer[];
}

const said = (room: string, text: string): Delivery => ({
	channel: `room:${room}:chat`,
	name: 'said',
	data: { text },
});

beforeAll(buildFixture, START_TIMEOUT_MS);

describe.each([
	['the built Worker', startBuiltWorker],
	['nuxt dev', () => startDevServer()],
])('under %s', (_name, start) => {
	let server: FixtureServer;

	beforeAll(async () => {
		server = await start();
	}, START_TIMEOUT_MS);
	afterAll(() => server?.stop());

	it('a socket the port admits hears what the server publishes to its scope, and no other', async () => {
		const [room, other] = [randomUUID(), randomUUID()];
		const here = await hear(connect(server, room), `room:${room}:chat`);
		const elsewhere = await hear(connect(server, other), `room:${other}:chat`);

		const answers = await publish(server, room, [said(room, 'hello')]);

		await until('the message', () => here.length === 1);
		expect(here).toEqual([{ text: 'hello' }]);
		expect(answers).toEqual([{ channel: `room:${room}:chat`, seq: 1, recipients: 1 }]);
		expect(elsewhere).toEqual([]);
	});

	it('a socket holds the grant its port gave, and no more', async () => {
		const room = randomUUID();
		const transport = connect(server, room);
		await hear(transport, `room:${room}:chat`);

		transport.onMessage('room:another:chat', 'said', () => {});

		await until('the refusal', () => transport.channelRefusals.length === 1);
		expect(transport.channelRefusals).toEqual([{ channel: 'room:another:chat', what: 'attach' }]);
	});

	it.each([
		['no credential', (): Record<string, string> => ({})],
		[
			"another origin's page",
			(): Record<string, string> => ({ ...page(server), origin: 'https://elsewhere.example' }),
		],
	])('a caller with %s is refused by a socket it can read', async (_who, headers) => {
		const transport = connect(server, randomUUID(), headers());
		transport.onMessage('room:any:chat', 'said', () => {});

		await until('the refusal', () => transport.refusal !== null);
		expect(transport.isConnected).toBe(false);
	});

	it('a port that fails is a failed attempt, which a page does not read as a refusal', async () => {
		const transport = connect(server, 'broken');
		transport.onMessage('room:broken:chat', 'said', () => {});

		await until('the failed attempt', () => transport.error !== null);
		expect(transport.refusal).toBeNull();
	});

	it('answers the port to nobody but the hand-off', async () => {
		const response = await fetch(`${server.origin}${PORT_PATH}?room=${randomUUID()}`, {
			headers: { ...page(server), [HAND_OFF_HEADER]: 'a-guess' },
		});

		expect(response.status).toBe(404);
		expect(await response.text()).not.toContain('admission');
	});

	it('answers a request for the socket that is no upgrade with 426', async () => {
		const response = await fetch(`${server.origin}${SOCKET_PATH}?room=${randomUUID()}`, {
			headers: page(server),
		});

		expect(response.status).toBe(426);
	});
});

// Two worktrees' dev servers, or one integration run's: each has its own dev
// Worker, though every one of them is bound by the same name.
describe('two dev servers at once', () => {
	let servers: FixtureServer[] = [];

	beforeAll(async () => {
		servers = await Promise.all([startDevServer('one'), startDevServer('two')]);
	}, START_TIMEOUT_MS);
	afterAll(() => Promise.all(servers.map((server) => server.stop())));

	it("each hears its own server's publishes, and not the other's", async () => {
		const room = randomUUID();
		const [one, two] = servers as [FixtureServer, FixtureServer];
		const atOne = await hear(connect(one, room), `room:${room}:chat`);
		const atTwo = await hear(connect(two, room), `room:${room}:chat`);

		await publish(one, room, [said(room, 'from one')]);
		await publish(two, room, [said(room, 'from two')]);

		await until('both messages', () => atOne.length === 1 && atTwo.length === 1);
		expect(atOne).toEqual([{ text: 'from one' }]);
		expect(atTwo).toEqual([{ text: 'from two' }]);
	});
});
