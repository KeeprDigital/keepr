/**
 * Throwaway prototype for #1295: the client half. What Ably's SDK does for
 * `app/plugins/realtime.client.ts` today, over one WebSocket to one object:
 * reconnection, catch-up, heartbeat, and ADR-0023's rule that nothing a consumer
 * asked for is forgotten on failure.
 *
 * It knows channels, sockets and presence, never an Event or a Screen. Stream
 * Keepr's rooms and typed messages (`RealtimeTransport`'s `setRoom`, `onRoom`,
 * `onChannel`) would be an adapter over `onMessage`, one transport per Event.
 * No framework and no DOM, so it runs under Node for the probe.
 */

export type ConnectionState =
	| 'initialized'
	| 'connecting'
	| 'connected'
	| 'disconnected'
	| 'suspended'
	| 'closed';

export interface PresenceMember {
	connectionId: string;
	data?: unknown;
}

export interface TransportOptions {
	/** The socket's URL, asked for on every attempt so a credential can change. */
	url: () => string;
	/** How often to ping, and how long to wait for the pong before giving the socket up. */
	heartbeatMs?: number;
	pongTimeoutMs?: number;
	/** How long an attempt may take to open: a dead network answers nothing at all. */
	connectTimeoutMs?: number;
	onState?: (state: ConnectionState) => void;
}

/**
 * ADR-0023's rhythm: quick retries, then a backoff that settles at one attempt
 * every 30 s for as long as anything waits. The first five are `disconnected`;
 * after them the transport is `suspended` and its fault is worth showing.
 */
const RETRY_MS = [250, 500, 1000, 2000, 4000, 5000, 10_000, 20_000];
const RETRY_CEILING_MS = 30_000;
const QUICK_RETRIES = 5;

const CLOSE_STALE = 4001;
const CLOSE_REFUSED = 4403;
const OPEN = 1;

type Handler = (data: unknown, frame: unknown) => void;

interface Channel {
	/** `null` until its first attach; after it, the last sequence delivered. */
	seq: number | null;
	attached: boolean;
	/** As the Ably transport keeps it: `lost` when the connection dropped before a first attach. */
	continuity: 'unstarted' | 'held' | 'lost';
	readonly handlers: Map<string, Set<Handler>>;
	readonly onLost: Set<() => void>;
	readonly onNextAttach: Set<() => void>;
}

export function createSocketTransport(options: TransportOptions) {
	const heartbeatMs = options.heartbeatMs ?? 15_000;
	const pongTimeoutMs = options.pongTimeoutMs ?? 5000;
	const connectTimeoutMs = options.connectTimeoutMs ?? 10_000;
	/** Names this client across its sockets, so a reconnect replaces the one it lost. */
	const clientId = crypto.randomUUID();

	const channels = new Map<string, Channel>();
	const entries = new Map<string, unknown>();
	const watches = new Map<string, Set<(members: PresenceMember[]) => void>>();

	let socket: WebSocket | null = null;
	let state: ConnectionState = 'initialized';
	let epoch: string | undefined;
	let connectionId: string | undefined;
	let error: Error | null = null;
	let refusal: Error | null = null;
	let attempt = 0;
	let disposed = false;
	let retryTimer: ReturnType<typeof setTimeout> | undefined;
	let connectTimer: ReturnType<typeof setTimeout> | undefined;
	let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
	let pongTimer: ReturnType<typeof setTimeout> | undefined;

	function setState(next: ConnectionState) {
		if (state === next) return;
		state = next;
		options.onState?.(next);
	}

	const isOutOfTouch = () => state === 'disconnected' || state === 'suspended';
	const wantsAnything = () => channels.size > 0 || watches.size > 0;

	function send(frame: object) {
		if (socket?.readyState === OPEN) socket.send(JSON.stringify(frame));
	}

	function channel(name: string): Channel {
		let held = channels.get(name);
		if (!held) {
			held = {
				seq: null,
				attached: false,
				continuity: isOutOfTouch() ? 'lost' : 'unstarted',
				handlers: new Map(),
				onLost: new Set(),
				onNextAttach: new Set(),
			};
			channels.set(name, held);
			if (socket?.readyState === OPEN) send({ t: 'attach', channel: name, epoch });
			else open();
		}
		return held;
	}

	/** Forget a channel nothing refers to any more; the last one closes the socket. */
	function release(name: string) {
		const held = channels.get(name);
		if (!held || entries.has(name)) return;
		if (held.handlers.size > 0 || held.onLost.size > 0 || held.onNextAttach.size > 0) return;
		channels.delete(name);
		send({ t: 'detach', channel: name });
		closeIfIdle();
	}

	function closeIfIdle() {
		if (wantsAnything()) return;
		clearTimeout(retryTimer);
		const leaving = socket;
		if (leaving) drop(leaving);
		leaving?.close(1000);
		setState('closed');
	}

	function open() {
		if (disposed || socket || !wantsAnything()) return;
		clearTimeout(retryTimer);
		if (state === 'initialized' || state === 'closed') setState('connecting');
		const url = new URL(options.url());
		url.searchParams.set('client', clientId);
		url.searchParams.set('hb', '1');
		const opening = new WebSocket(url);
		socket = opening;
		connectTimer = setTimeout(() => giveUp(opening, 'did not open'), connectTimeoutMs);

		opening.addEventListener('open', () => {
			if (socket !== opening) return;
			clearTimeout(connectTimer);
			// Everything wanted, in one frame: the object replaces what this client's
			// last socket held with it.
			send({
				t: 'hello',
				epoch,
				attach: [...channels].map(([name, held]) => ({
					channel: name,
					...(held.seq !== null && { since: held.seq }),
				})),
				watch: [...watches.keys()],
				presence: Object.fromEntries(entries),
			});
			heartbeatTimer = setInterval(checkNow, heartbeatMs);
		});
		opening.addEventListener('message', (event) => {
			if (socket === opening) receive(String(event.data));
		});
		opening.addEventListener('close', (event) => {
			if (event.code === CLOSE_REFUSED) refusal = new Error(`Refused: ${event.reason}`);
			drop(opening, event.code);
		});
		// An error is always followed by a close; the close does the work.
		opening.addEventListener('error', () => {
			error = new Error('The realtime connection failed');
		});
	}

	/** Stop waiting on a socket that has gone quiet: its close may never arrive. */
	function giveUp(quiet: WebSocket, why: string) {
		if (socket !== quiet) return;
		error = new Error(`The realtime connection ${why}`);
		drop(quiet);
		quiet.close();
	}

	function drop(dropped: WebSocket, code?: number) {
		if (socket !== dropped) return;
		socket = null;
		connectionId = undefined;
		clearTimeout(connectTimer);
		clearInterval(heartbeatTimer);
		clearTimeout(pongTimer);
		pongTimer = undefined;
		for (const held of channels.values()) {
			if (held.continuity === 'unstarted') held.continuity = 'lost';
			held.attached = false;
		}
		if (disposed || !wantsAnything()) return;
		// A refusal is not a blip: it goes straight to the slow rhythm. A socket the
		// object swept for silence was only slow to ping, and comes straight back.
		if (code === CLOSE_REFUSED) attempt = Math.max(attempt, QUICK_RETRIES);
		const delay = code === CLOSE_STALE ? 0 : (RETRY_MS[attempt] ?? RETRY_CEILING_MS);
		attempt += 1;
		setState(attempt > QUICK_RETRIES ? 'suspended' : 'disconnected');
		retryTimer = setTimeout(open, delay);
	}

	/** Ask the socket whether it is still there. Also for a page's `online` and `visibilitychange`. */
	function checkNow() {
		if (socket?.readyState !== OPEN || pongTimer) return;
		const asked = socket;
		asked.send('ping');
		pongTimer = setTimeout(() => {
			pongTimer = undefined;
			giveUp(asked, 'stopped answering');
		}, pongTimeoutMs);
	}

	function receive(raw: string) {
		// Anything heard proves the socket alive, and the first thing heard that it
		// was let in: a refused socket opens too, and closes saying nothing.
		clearTimeout(pongTimer);
		pongTimer = undefined;
		setState('connected');
		if (raw === 'pong') return;
		const frame = JSON.parse(raw) as
			| {
					t: 'attached';
					channel: string;
					resumed: boolean;
					seq: number;
					epoch: string;
					connectionId: string;
			  }
			| { t: 'msg'; channel: string; seq: number; name: string; data: unknown }
			| { t: 'presence'; channel: string; members: PresenceMember[] };

		if (frame.t === 'presence') {
			for (const callback of [...(watches.get(frame.channel) ?? [])]) callback(frame.members);
			return;
		}
		const held = channels.get(frame.channel);
		if (!held) return;

		if (frame.t === 'attached') {
			epoch = frame.epoch;
			connectionId = frame.connectionId;
			attempt = 0;
			error = null;
			refusal = null;
			const before = held.continuity;
			const wasAttached = held.attached;
			held.attached = true;
			held.continuity = 'held';
			if (!frame.resumed) held.seq = frame.seq;
			if (!wasAttached) {
				const waiting = [...held.onNextAttach];
				held.onNextAttach.clear();
				for (const handler of waiting) handler();
			}
			// A first attach on an unbroken connection missed nothing anyone had yet.
			if (!frame.resumed && before !== 'unstarted')
				for (const handler of [...held.onLost]) handler();
			return;
		}

		if (!held.attached || held.seq === null || frame.seq <= held.seq) return;
		// One socket is ordered, so a hole means the object skipped: say so and carry on.
		const hole = frame.seq !== held.seq + 1;
		held.seq = frame.seq;
		if (hole) for (const handler of [...held.onLost]) handler();
		for (const handler of [...(held.handlers.get(frame.name) ?? [])]) handler(frame.data, frame);
	}

	return {
		get connectionState() {
			return state;
		},
		get isConnected() {
			return state === 'connected';
		},
		get connectionId() {
			return connectionId;
		},
		get error() {
			return error;
		},
		/** The object refused this client. Stands, while retries go on, until a channel attaches. */
		get refusal() {
			return refusal;
		},
		checkNow,

		onMessage(name: string, type: string, handler: Handler) {
			const held = channel(name);
			if (!held.handlers.has(type)) held.handlers.set(type, new Set());
			held.handlers.get(type)!.add(handler);
			return () => {
				held.handlers.get(type)?.delete(handler);
				if (held.handlers.get(type)?.size === 0) held.handlers.delete(type);
				release(name);
			};
		},

		onContinuityLost(name: string, handler: () => void) {
			const held = channel(name);
			held.onLost.add(handler);
			return () => {
				held.onLost.delete(handler);
				release(name);
			};
		},

		onceAttached(name: string, handler: () => void) {
			const held = channel(name);
			if (held.attached) return () => {};
			held.onNextAttach.add(handler);
			return () => {
				held.onNextAttach.delete(handler);
				release(name);
			};
		},

		/** Entered now on an open socket, and otherwise held until one opens. */
		enterPresence(name: string, data: unknown) {
			entries.set(name, data);
			channel(name);
			// On an open socket the attach is already ahead of this; on none, the
			// next `hello` carries the entry.
			send({ t: 'enter', channel: name, data });
			return Promise.resolve();
		},

		updatePresence(name: string, data: unknown) {
			if (!entries.has(name)) return Promise.resolve();
			entries.set(name, data);
			send({ t: 'update', channel: name, data });
			return Promise.resolve();
		},

		leavePresence(name: string) {
			if (entries.delete(name)) send({ t: 'leave', channel: name });
			release(name);
			return Promise.resolve();
		},

		watchPresence(name: string, callback: (members: PresenceMember[]) => void) {
			if (!watches.has(name)) {
				watches.set(name, new Set());
				if (socket?.readyState === OPEN) send({ t: 'watch', channel: name });
				else open();
			}
			watches.get(name)!.add(callback);
			return () => {
				const watching = watches.get(name);
				watching?.delete(callback);
				if (watching?.size !== 0) return;
				watches.delete(name);
				send({ t: 'unwatch', channel: name });
				closeIfIdle();
			};
		},

		dispose() {
			disposed = true;
			clearTimeout(retryTimer);
			const leaving = socket;
			if (leaving) drop(leaving);
			leaving?.close(1000);
			setState('closed');
		},
	};
}

export type SocketTransport = ReturnType<typeof createSocketTransport>;
