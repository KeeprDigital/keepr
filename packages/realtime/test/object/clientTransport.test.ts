import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createSocketTransport } from '../../src/client/index.ts';
import type { SocketTransport } from '../../src/client/index.ts';
import type { Grant } from '../../src/object/grant.ts';
import type { PresenceMember } from '../../src/protocol.ts';
import { anyone, startServer } from './server.ts';
import type { Scope, Server } from './server.ts';

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
function connect(scope: Scope, grant: () => Grant | null = () => anyone): SocketTransport {
	const transport = createSocketTransport({ address: () => scope.address(grant()) });
	transports.add(transport);
	return transport;
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
