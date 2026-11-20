import type { ProbeRecord } from '../../../scripts/realtime-probe/measure.mjs';
import { describe, expect, it } from 'vitest';
import { createProbeClient } from '../../../scripts/realtime-probe/client.mjs';

// One client of the realtime probe (#1338): the package's client transport on
// a socket the probe taps and can cut. The socket is the boundary, and is the
// only thing faked: the transport under test is the real one.

const CHANNEL = 'screen:1:2';

/** A WebSocket as Node's is constructed, which a test opens, speaks on and reads. */
function fakeSockets() {
	const opened: FakeSocket[] = [];
	class FakeSocket {
		readyState = 0;
		readonly sent: string[] = [];
		readonly #listeners = new Map<string, ((event: object) => void)[]>();

		constructor(
			readonly url: string,
			readonly init: { headers: Record<string, string> },
		) {
			opened.push(this);
		}

		addEventListener(type: string, listener: (event: object) => void) {
			this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), listener]);
		}

		#tell(type: string, event: object) {
			for (const listener of this.#listeners.get(type) ?? []) listener(event);
		}

		send(data: string) {
			this.sent.push(data);
		}

		/** Whether the other end answers a close. One that does not leaves the socket closing for good. */
		answersClose = true;

		close() {
			this.readyState = this.answersClose ? 3 : 2;
			if (this.answersClose) this.#tell('close', { code: 1000 });
		}

		/** The object accepts the socket. */
		open() {
			this.readyState = 1;
			this.#tell('open', {});
		}

		/** The object sends a frame. */
		says(frame: object) {
			this.#tell('message', { data: JSON.stringify(frame) });
		}

		/** The frames the client sent, but for its pings. */
		get frames(): any[] {
			return this.sent.filter((data) => data !== 'ping').map((data) => JSON.parse(data));
		}
	}
	return { opened, WebSocket: FakeSocket };
}

/** The transport's timers, which fire only when a test says its waits are over. */
function heldTimers() {
	const waiting = new Set<() => void>();
	return {
		timers: {
			setTimeout: (callback: () => void) => (waiting.add(callback), callback),
			clearTimeout: (handle: unknown) => void waiting.delete(handle as () => void),
		},
		/** Every wait the transport is in ends: its retry among them. */
		elapse() {
			for (const callback of [...waiting]) {
				waiting.delete(callback);
				callback();
			}
		},
	};
}

/** A client on `CHANNEL` whose socket, clock and timers the test holds. */
function aClient() {
	const sockets = fakeSockets();
	const held = heldTimers();
	const records: ProbeRecord[] = [];
	const clock = { now: 1000 };
	const asked = { addresses: 0 };
	const client = createProbeClient({
		name: 'output-2',
		role: 'output',
		channels: [CHANNEL],
		address: async () => {
			asked.addresses += 1;
			return `ws://stream.test/realtime/socket?eventId=1&ticket=t${asked.addresses}`;
		},
		headers: { origin: 'http://stream.test' },
		isProbeMessage: (frame) => frame.name === 'probe',
		record: (entry) => records.push(entry),
		now: () => clock.now,
		WebSocket: sockets.WebSocket,
		transport: { timers: held.timers },
	});
	/** The socket the transport opens once its address is answered. */
	const nextSocket = async () => {
		const count = sockets.opened.length;
		await expect.poll(() => sockets.opened.length).toBe(count + 1);
		return sockets.opened.at(-1)!;
	};
	const of = (kind: ProbeRecord['kind']) => records.filter((entry) => entry.kind === kind);
	return {
		client,
		sockets: sockets.opened,
		records,
		clock,
		asked,
		nextSocket,
		of,
		elapse: held.elapse,
	};
}

const attached = (seq: number, resumed = false) => ({
	t: 'attached',
	channel: CHANNEL,
	resumed,
	seq,
	epoch: 'storage-a',
	connectionId: 'c1',
});
const message = (seq: number, name = 'probe', extra: object = {}) => ({
	t: 'msg',
	channel: CHANNEL,
	seq,
	name,
	data: {},
	sentAt: 5000 + seq,
	...extra,
});

describe('a client of the realtime probe', () => {
	it('opens its socket with what its browser would send, and says what it is', async () => {
		const { sockets, records, nextSocket } = aClient();

		const socket = await nextSocket();

		expect(socket.init).toEqual({ headers: { origin: 'http://stream.test' } });
		expect(sockets).toHaveLength(1);
		expect(records[0]).toEqual({
			kind: 'client',
			client: 'output-2',
			role: 'output',
			channels: [CHANNEL],
		});
	});

	it('records what its socket carries, by the probe’s clock, and tells its own messages apart', async () => {
		const { client, clock, nextSocket, of } = aClient();
		const socket = await nextSocket();
		socket.open();

		clock.now = 2000;
		socket.says(attached(4));
		await client.attached;
		clock.now = 2100;
		socket.says(message(5));
		socket.says(message(6, 'screen:updated'));
		socket.says(message(7, 'probe', { replayed: true }));

		expect(of('attached')).toEqual([
			{
				kind: 'attached',
				client: 'output-2',
				channel: CHANNEL,
				at: 2000,
				resumed: false,
				seq: 4,
				epoch: 'storage-a',
			},
		]);
		expect(of('message')).toEqual([
			expect.objectContaining({ seq: 5, at: 2100, sentAt: 5005, replayed: false, probe: true }),
			expect.objectContaining({ seq: 6, name: 'screen:updated', probe: false }),
			expect.objectContaining({ seq: 7, replayed: true, probe: true }),
		]);
		expect(of('state').map((entry) => 'state' in entry && entry.state)).toEqual([
			'connecting',
			'connected',
		]);
	});

	it('closes its socket when cut, hears nothing more on it, and asks for no address while cut', async () => {
		const { client, asked, sockets, nextSocket, of, elapse } = aClient();
		const socket = await nextSocket();
		socket.open();
		socket.says(attached(4));

		client.cut();
		socket.says(message(5));
		// The transport retries, as it does through any cut, and is given no address.
		elapse();
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(socket.readyState).toBe(3);
		expect(of('message')).toEqual([]);
		expect(of('cut')).toHaveLength(1);
		expect(asked.addresses).toBe(1);
		expect(sockets).toHaveLength(1);
		expect(client.connected).toBe(false);
	});

	it('is cut at once, and comes back when restored, though the close of its socket is never answered', async () => {
		const { client, clock, nextSocket, of } = aClient();
		const first = await nextSocket();
		first.open();
		first.says(attached(4));
		first.answersClose = false;

		clock.now = 2500;
		client.cut();

		expect(client.connected).toBe(false);
		expect(of('state').at(-1)).toEqual({
			kind: 'state',
			client: 'output-2',
			at: 2500,
			state: 'disconnected',
			why: 'The realtime connection closed (1006)',
		});

		client.restore();
		(await nextSocket()).open();
	});

	it('opens no socket on an address that was on its way when it was cut', async () => {
		const sockets = fakeSockets();
		let answer = (_address: string) => {};
		const client = createProbeClient({
			name: 'output-2',
			role: 'output',
			channels: [CHANNEL],
			address: () => new Promise<string>((resolve) => (answer = resolve)),
			isProbeMessage: () => false,
			record: () => {},
			now: () => 0,
			WebSocket: sockets.WebSocket,
			transport: { timers: heldTimers().timers },
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		client.cut();
		answer('ws://stream.test/realtime/socket?eventId=1&ticket=t1');
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(sockets.opened).toHaveLength(0);
	});

	it('comes back at once when restored, on a socket of its own address, asking for what followed', async () => {
		const { client, asked, clock, nextSocket, of } = aClient();
		const first = await nextSocket();
		first.open();
		first.says(attached(4));
		first.says(message(5));
		client.cut();

		clock.now = 3000;
		client.restore();
		const second = await nextSocket();
		second.open();

		expect(of('restore')).toEqual([{ kind: 'restore', client: 'output-2', at: 3000 }]);
		expect(asked.addresses).toBe(2);
		expect(second.url).toContain('ticket=t2');
		expect(second.frames[0]).toMatchObject({
			t: 'hello',
			attach: [{ channel: CHANNEL, since: 5 }],
			epoch: 'storage-a',
		});
	});

	it('enters the presence it is given, as a Screen Output does', async () => {
		const sockets = fakeSockets();
		createProbeClient({
			name: 'output-2',
			role: 'output',
			channels: [CHANNEL],
			address: () => 'ws://stream.test/realtime/socket?eventId=1',
			enter: { channel: CHANNEL, data: { screenId: 2 } },
			isProbeMessage: () => false,
			record: () => {},
			now: () => 0,
			WebSocket: sockets.WebSocket,
			transport: { timers: heldTimers().timers },
		});
		await expect.poll(() => sockets.opened.length).toBe(1);
		sockets.opened[0]!.open();

		expect(sockets.opened[0]!.frames[0]).toMatchObject({
			t: 'hello',
			presence: { [CHANNEL]: { screenId: 2 } },
		});
	});

	it('records nothing of its own ending', async () => {
		const { client, records, nextSocket } = aClient();
		const socket = await nextSocket();
		socket.open();
		socket.says(attached(4));
		const before = records.length;

		client.stop();

		expect(socket.readyState).toBe(3);
		expect(records).toHaveLength(before);
	});
});
