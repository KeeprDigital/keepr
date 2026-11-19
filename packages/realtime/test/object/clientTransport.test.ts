import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createSocketTransport } from '../../src/client/index.ts';
import type {
	SocketEvent,
	SocketLike,
	SocketTransport,
	SocketTransportOptions,
} from '../../src/client/index.ts';
import type { Grant } from '../../src/object/grant.ts';
import { PING, PONG } from '../../src/protocol.ts';
import type { AskFrame, PresenceMember } from '../../src/protocol.ts';
import { sleep } from './client.ts';
import { anyone, startServer } from './server.ts';
import type { Scope, Server } from './server.ts';
import { ASKED_SWEEP_MS } from './timings.ts';

let server: Server;
const transports = new Set<SocketTransport>();
beforeAll(async () => {
	server = await startServer();
}, 60_000);
afterEach(() => {
	for (const transport of transports) transport.dispose();
	transports.clear();
	server.closeSockets();
});
afterAll(() => server.close());

/** The package's own client, on Node's WebSocket and timers, to the real object. */
function connect(
	scope: Scope,
	grant: () => Grant | null = () => anyone,
	options: Partial<SocketTransportOptions> = {},
): SocketTransport {
	const transport = createSocketTransport({ ...options, address: () => scope.address(grant()) });
	transports.add(transport);
	return transport;
}

/** A heartbeat that pings as its socket opens and never again, as a page whose timers have stopped. */
const NEVER_MS = 60 * 60 * 1000;

const ASK = JSON.stringify({ t: 'ask' } satisfies AskFrame);

/**
 * Node's WebSocket, with each ask held back until the test lets it through, so
 * the test can put the object to sleep between its ask and the answer.
 */
function gated() {
	const gate = { held: [] as (() => void)[], pings: 0, pongs: 0 };
	class Gated implements SocketLike {
		readonly #socket: WebSocket;

		constructor(url: string) {
			this.#socket = new WebSocket(url);
		}

		get readyState(): number {
			return this.#socket.readyState;
		}

		send(data: string): void {
			if (data === PING) gate.pings += 1;
			this.#socket.send(data);
		}

		close(code?: number, reason?: string): void {
			this.#socket.close(code, reason);
		}

		addEventListener(
			type: Parameters<SocketLike['addEventListener']>[0],
			listener: (event: SocketEvent) => void,
		): void {
			this.#socket.addEventListener(type, (heard: Event) => {
				const event = heard as SocketEvent;
				if (event.data === PONG) gate.pongs += 1;
				if (event.data === ASK) gate.held.push(() => listener(event));
				else listener(event);
			});
		}
	}
	return { gate, WebSocket: Gated };
}

/** What `channel` delivers to the transport, in the order it came. */
function hear(transport: SocketTransport, channel: string): { heard: unknown[]; lost: number[] } {
	const told = { heard: [] as unknown[], lost: [] as number[] };
	transport.onMessage(channel, 'said', (data) => told.heard.push(data));
	transport.onContinuityLost(channel, () => told.lost.push(told.heard.length));
	return told;
}

const attached = (transport: SocketTransport, channel: string): Promise<void> =>
	new Promise((resolve) => transport.onceAttached(channel, resolve));

describe('the client transport, against the object in local workerd', () => {
	it('hears what is published once it has attached', async () => {
		const scope = server.scope();
		const transport = connect(scope);
		const news = hear(transport, 'news');
		await attached(transport, 'news');

		await scope.publish({ channel: 'news', name: 'said', data: 1 });

		await vi.waitFor(() => expect(news.heard).toEqual([1]));
		expect(transport.connectionState).toBe('connected');
		expect(transport.connectionId).toEqual(expect.any(String));
	});

	it('catches up what was published while its socket was closed, once and in order, telling no loss', async () => {
		const scope = server.scope();
		const transport = connect(scope);
		const news = hear(transport, 'news');
		await attached(transport, 'news');
		await scope.publish({ channel: 'news', name: 'said', data: 1 });
		await vi.waitFor(() => expect(news.heard).toEqual([1]));

		// The object is stopped and its sockets closed; it starts again from its storage.
		await scope.restart();
		await scope.publish(
			{ channel: 'news', name: 'said', data: 2 },
			{ channel: 'news', name: 'said', data: 3 },
		);

		await vi.waitFor(() => expect(news.heard).toEqual([1, 2, 3]), 5000);
		await scope.publish({ channel: 'news', name: 'said', data: 4 });
		await vi.waitFor(() => expect(news.heard).toEqual([1, 2, 3, 4]));
		expect(news.lost).toEqual([]);
	});

	it('is told of a loss, once, when the log no longer covers what it missed', async () => {
		const scope = server.scope('BRIEF_LOG');
		const transport = connect(scope);
		const news = hear(transport, 'news');
		await attached(transport, 'news');
		await scope.publish({ channel: 'news', name: 'said', data: 1 });
		await vi.waitFor(() => expect(news.heard).toEqual([1]));

		// Wiped, the object starts another epoch: the sequence the client holds is no longer its own.
		await scope.call('wipe');
		await scope.restart();

		await vi.waitFor(() => expect(news.lost).toEqual([1]), 5000);
		await scope.publish({ channel: 'news', name: 'said', data: 2 });
		await vi.waitFor(() => expect(news.heard).toEqual([1, 2]));
		expect(news.lost).toEqual([1]);
	});

	it('keeps its place in presence through a closed socket, and a watcher is never told it left', async () => {
		const scope = server.scope();
		const watcher = connect(scope);
		const seen: PresenceMember[][] = [];
		watcher.watchPresence('stage', (members) => seen.push(members));
		const member = connect(scope);
		member.enterPresence('stage', { ready: true });
		await vi.waitFor(() =>
			expect(seen.at(-1)).toEqual([expect.objectContaining({ data: { ready: true } })]),
		);

		await scope.restart();
		member.updatePresence('stage', { ready: false });

		await vi.waitFor(
			() => expect(seen.at(-1)).toEqual([expect.objectContaining({ data: { ready: false } })]),
			5000,
		);
		// Nobody, then the member: never nobody again.
		expect(seen.map((members) => members.length).slice(1)).not.toContain(0);
	});

	it('stays in presence past the sweep though its heartbeat never fires, by answering the ask', async () => {
		const scope = server.scope('BRIEF_ASK');
		const watcher = connect(scope);
		const seen: PresenceMember[][] = [];
		watcher.watchPresence('stage', (members) => seen.push(members));
		const member = connect(scope, () => anyone, { heartbeatMs: NEVER_MS });
		member.enterPresence('stage', { ready: true });
		await vi.waitFor(() =>
			expect(seen.at(-1)).toEqual([expect.objectContaining({ data: { ready: true } })]),
		);
		const told = seen.length;

		await sleep(ASKED_SWEEP_MS * 1.5);

		// Swept, it would have been told of as gone, closed as stale, and come back.
		expect(seen).toHaveLength(told);
		expect(member.connectionState).toBe('connected');
	}, 15_000);

	it('answers the ask without waking the object', async () => {
		const scope = server.scope('BRIEF_ASK');
		const { gate, WebSocket } = gated();
		const member = connect(scope, () => anyone, { heartbeatMs: NEVER_MS, WebSocket });
		member.enterPresence('stage', { ready: true });
		await vi.waitFor(() => expect(gate.held).toHaveLength(1), ASKED_SWEEP_MS);
		const wakes = await scope.call<number>('wakes');
		const before = { ...gate };

		await scope.hibernate();
		gate.held.shift()?.();
		await vi.waitFor(() => expect(gate.pongs).toBe(before.pongs + 1));
		// Put to sleep again if the answer woke it, which the harness refuses when it
		// did not. So asking for the count wakes it once more, and an answer that had
		// woken it would make that twice.
		await scope.hibernate().catch(() => {});

		expect(gate.pings).toBe(before.pings + 1);
		expect(await scope.call<number>('wakes')).toBe(wakes + 1);
	}, 15_000);

	it('reads a refusal by the app, keeps retrying, and connects once it is let in', async () => {
		const scope = server.scope();
		let grant: Grant | null = null;
		const transport = connect(scope, () => grant);
		const news = hear(transport, 'news');

		await vi.waitFor(() => expect(transport.refusal).toBeInstanceOf(Error));
		expect(transport.isConnected).toBe(false);

		grant = anyone;
		transport.checkNow();
		await attached(transport, 'news');
		expect(transport.refusal).toBeNull();
		await scope.publish({ channel: 'news', name: 'said', data: 1 });
		await vi.waitFor(() => expect(news.heard).toEqual([1]));
	});

	it('reads a disconnect by tag as a refusal', async () => {
		const scope = server.scope();
		const transport = connect(scope, () => ({ ...anyone, tags: ['credential-1'] }));
		hear(transport, 'news');
		await attached(transport, 'news');

		expect(await scope.disconnect('credential-1')).toBe(1);

		await vi.waitFor(() => expect(transport.refusal).toBeInstanceOf(Error));
	});

	it('lists a channel its grant does not cover, and still hears the one it does', async () => {
		const scope = server.scope();
		const transport = connect(scope, () => ({ identity: 'reader', hear: ['news'] }));
		const news = hear(transport, 'news');
		hear(transport, 'secrets');
		await attached(transport, 'news');

		await vi.waitFor(() =>
			expect(transport.channelRefusals).toEqual([{ channel: 'secrets', what: 'attach' }]),
		);
		await scope.publish(
			{ channel: 'secrets', name: 'said', data: 'no' },
			{ channel: 'news', name: 'said', data: 'yes' },
		);
		await vi.waitFor(() => expect(news.heard).toEqual(['yes']));
	});
});
