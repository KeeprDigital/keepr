/**
 * The client half of ADR-0137: one socket to one scope's object, with the
 * reconnection, catch-up and heartbeat that are the transport's own, and
 * ADR-0023's rule that nothing a consumer asked for is forgotten on failure.
 *
 * It knows channels, sockets and presence, and names no product. It has no
 * framework in it and uses no DOM or Node API: its socket and timers are handed
 * to it, or are whatever `globalThis` has, in a browser and under Node alike.
 */
import {
	CLIENT_ID_PARAM,
	CLOSE_REFUSED,
	CLOSE_STALE,
	CLOSE_SUPERSEDED,
	PING,
	PONG,
} from '../protocol.ts';
import type {
	AttachFrame,
	ClientFrame,
	HelloFrame,
	MessageFrame,
	PresenceMember,
	RefusedFrame,
	ServerFrame,
} from '../protocol.ts';

/**
 * Where the transport stands with its object.
 *
 * - `initialized`: nothing has been asked of it yet.
 * - `connecting`: its first connect, or the first since it was `closed`.
 * - `connected`: a frame has been heard on its socket. An open socket is not
 *   enough: a refused one opens too, and closes saying nothing.
 * - `disconnected`: it has no connection and is retrying.
 * - `suspended`: the fault. It has been without a connection for
 *   `faultAfterMs`, whatever the count of retries, and is still retrying.
 * - `superseded`: a newer socket of this same client replaced its socket. It
 *   does not retry by itself; `checkNow()` connects again.
 * - `closed`: disposed, or nothing is asked of it any more.
 */
export type ConnectionState =
	| 'initialized'
	| 'connecting'
	| 'connected'
	| 'disconnected'
	| 'suspended'
	| 'superseded'
	| 'closed';

/** What the transport reads of a socket's events. */
export interface SocketEvent {
	readonly data?: unknown;
	readonly code?: number;
	readonly reason?: string;
}

/** As much of a WebSocket as the transport uses. A browser's and Node's both are one. */
export interface SocketLike {
	readonly readyState: number;
	send(data: string): void;
	close(code?: number, reason?: string): void;
	addEventListener(
		type: 'open' | 'message' | 'close' | 'error',
		listener: (event: SocketEvent) => void,
	): void;
}

export type SocketConstructor = new (url: string) => SocketLike;

/** The timers the transport runs on: the runtime's own, or a test's clock. */
export interface Timers {
	setTimeout(callback: () => void, ms: number): unknown;
	clearTimeout(handle: unknown): void;
}

export interface SocketTransportOptions {
	/**
	 * The socket's address, asked for on every connect and waited for, so a caller
	 * can fetch a single-use ticket for each socket. One that throws, rejects or
	 * outlasts the connect timeout is a failed attempt like any other. The transport
	 * adds its client id (`CLIENT_ID_PARAM`) to the query, so it must carry none.
	 */
	address: () => string | PromiseLike<string>;
	/** How often an open socket is pinged. 15 s. */
	heartbeatMs?: number;
	/** How long a ping waits for a pong, or any frame, before the socket is given up. 5 s. */
	pongTimeoutMs?: number;
	/** How long a connect may take, from asking for the address to the socket opening. 10 s. */
	connectTimeoutMs?: number;
	/** How long the transport is without a connection before it is `suspended`. 8 s. */
	faultAfterMs?: number;
	/** The WebSocket constructor. The runtime's own when not given. */
	WebSocket?: SocketConstructor;
	/** The timers. The runtime's own when not given. */
	timers?: Timers;
}

export type MessageHandler = (data: unknown, frame: MessageFrame) => void;
export type PresenceCallback = (members: PresenceMember[]) => void;

/** The object's answer that this client may not do `what` on `channel`. */
export type ChannelRefusal = Pick<RefusedFrame, 'channel' | 'what'>;

export interface SocketTransport {
	/** The name this transport gives every socket it opens, for its whole life. */
	readonly clientId: string;
	readonly connectionState: ConnectionState;
	readonly isConnected: boolean;
	/** The connected socket's id, once a channel has attached on it. */
	readonly connectionId: string | undefined;
	/** Why there is no connection, when there is none and one is wanted. */
	readonly error: Error | null;
	/**
	 * The object refused this client (`CLOSE_REFUSED`), as distinct from a network
	 * that does not answer. It stands, while retries go on at the slow rhythm, until
	 * a connect succeeds.
	 */
	readonly refusal: Error | null;
	/**
	 * What the connected object refused this client on a channel. Each stays
	 * wanted: the next socket asks again, and its answer replaces this one. A
	 * refusal ends when its consumer ends what was asked.
	 */
	readonly channelRefusals: readonly ChannelRefusal[];
	/** Call `listener` whenever any of the above changes. */
	onChange(listener: () => void): () => void;
	/**
	 * Find out now: ask an open socket whether it is still there, connect at once
	 * when waiting to retry, and connect again when superseded. For a page's
	 * `online` and `visibilitychange` (`checkOnPageEvents`).
	 */
	checkNow(): void;
	/** Hear `channel`'s messages named `name`, from now until disposed. */
	onMessage(channel: string, name: string, handler: MessageHandler): () => void;
	/**
	 * Call `handler` each time `channel` attaches having lost messages: a reattach
	 * the log could not cover, a first attach the connection dropped before, or a
	 * sequence skipped while attached.
	 */
	onContinuityLost(channel: string, handler: () => void): () => void;
	/** Call `handler` once, when `channel` next attaches, unless it is attached already. */
	onceAttached(channel: string, handler: () => void): () => void;
	/** Enter `channel`'s presence, now or as soon as a socket opens. */
	enterPresence(channel: string, data: unknown): void;
	/** Replace the data of an entry made, or still held. Nothing without an entry. */
	updatePresence(channel: string, data: unknown): void;
	/** Withdraw the entry: leave if entered, and never enter if still held. */
	leavePresence(channel: string): void;
	/** Be told `channel`'s members, whole, whenever they change. */
	watchPresence(channel: string, callback: PresenceCallback): () => void;
	/** End everything: timers, socket and listeners. Nothing asked afterwards is acted on. */
	dispose(): void;
}

/** The waits before each retry in turn; after the last, one every `RETRY_CEILING_MS`. */
const RETRY_MS = [250, 500, 1000, 2000, 4000, 5000, 10_000, 20_000];
const RETRY_CEILING_MS = 30_000;
/** How many of `RETRY_MS` are the quick ones. A refusal skips them. */
const QUICK_RETRIES = 5;
/** `WebSocket.OPEN`. */
const OPEN = 1;

/** What a runtime may have that the transport uses when it is handed nothing. */
interface Runtime {
	WebSocket?: SocketConstructor;
	setTimeout?: (callback: () => void, ms: number) => unknown;
	clearTimeout?: (handle: unknown) => void;
	crypto?: { getRandomValues?: (bytes: Uint8Array) => Uint8Array };
}

const runtime = globalThis as Runtime;

/** Called on `globalThis`, as a browser requires of its timers. */
const runtimeTimers: Timers = {
	setTimeout: (callback, ms) => {
		if (!runtime.setTimeout) throw new Error('This runtime has no setTimeout: pass `timers`');
		return runtime.setTimeout(callback, ms);
	},
	clearTimeout: (handle) => runtime.clearTimeout?.(handle),
};

/**
 * An id no other client will have. `crypto.randomUUID` is missing on a page
 * served over plain HTTP, where `getRandomValues` is not.
 */
function randomId(): string {
	const bytes = new Uint8Array(16);
	if (runtime.crypto?.getRandomValues) runtime.crypto.getRandomValues(bytes);
	else for (const index of bytes.keys()) bytes[index] = Math.floor(Math.random() * 256);
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function withClientId(address: string, clientId: string): string {
	return `${address}${address.includes('?') ? '&' : '?'}${CLIENT_ID_PARAM}=${clientId}`;
}

/** A listener held by its own registration, so one handler asked for twice is told twice. */
interface Held<Listener> {
	readonly call: Listener;
}

interface Channel {
	/** `null` until its first attach; after it, the last sequence delivered. */
	seq: number | null;
	attached: boolean;
	/** `lost` when the connection dropped before a first attach, which is then a loss. */
	continuity: 'unstarted' | 'held' | 'lost';
	readonly handlers: Map<string, Set<Held<MessageHandler>>>;
	readonly onLost: Set<Held<() => void>>;
	readonly onNextAttach: Set<Held<() => void>>;
}

interface Watch {
	readonly callbacks: Set<Held<PresenceCallback>>;
	/** The members last heard, for a watcher that comes later. */
	members: PresenceMember[] | undefined;
}

/** One connect: the wait for its address, then its socket. */
interface Attempt {
	socket: SocketLike | null;
}

export function createSocketTransport(options: SocketTransportOptions): SocketTransport {
	const heartbeatMs = options.heartbeatMs ?? 15_000;
	const pongTimeoutMs = options.pongTimeoutMs ?? 5000;
	const connectTimeoutMs = options.connectTimeoutMs ?? 10_000;
	const faultAfterMs = options.faultAfterMs ?? 8000;
	const timers = options.timers ?? runtimeTimers;
	const clientId = randomId();

	const channels = new Map<string, Channel>();
	const entries = new Map<string, unknown>();
	const watches = new Map<string, Watch>();
	const refusals = new Map<string, Set<ChannelRefusal['what']>>();
	const changeListeners = new Set<Held<() => void>>();

	/** The connect in flight or the socket in use. Nothing of an earlier one is heard. */
	let live: Attempt | null = null;
	let state: ConnectionState = 'initialized';
	let connectionId: string | undefined;
	let error: Error | null = null;
	let refusal: Error | null = null;
	let epoch: string | undefined;
	/** Failed attempts since the last connect: the place in `RETRY_MS`. */
	let failures = 0;
	let disposed = false;
	let retryTimer: unknown;
	let connectTimer: unknown;
	let heartbeatTimer: unknown;
	let pongTimer: unknown;
	let faultTimer: unknown;

	/**
	 * Tell every listener, whatever one of them throws: a consumer that fails must
	 * not cost another its message. What it threw is thrown again from a timer, to
	 * surface where the runtime reports an uncaught error.
	 */
	function tell<Arguments extends unknown[]>(
		listeners: Iterable<Held<(...args: Arguments) => void>>,
		...args: Arguments
	) {
		for (const listener of [...listeners]) {
			try {
				listener.call(...args);
			} catch (thrown) {
				timers.setTimeout(() => {
					throw thrown;
				}, 0);
			}
		}
	}

	function changed() {
		tell(changeListeners);
	}

	function set(next: {
		state?: ConnectionState;
		connectionId?: string | undefined;
		error?: Error | null;
		refusal?: Error | null;
	}) {
		const before = [state, connectionId, error, refusal];
		if (next.state !== undefined) state = next.state;
		if ('connectionId' in next) connectionId = next.connectionId;
		if (next.error !== undefined) error = next.error;
		if (next.refusal !== undefined) refusal = next.refusal;
		const after = [state, connectionId, error, refusal];
		if (after.some((value, index) => value !== before[index])) changed();
	}

	function clearTimers(...handles: unknown[]) {
		for (const handle of handles) if (handle !== undefined) timers.clearTimeout(handle);
	}

	const isOutOfTouch = () =>
		state === 'disconnected' || state === 'suspended' || state === 'superseded';
	const wantsAnything = () => channels.size > 0 || watches.size > 0;

	function send(frame: ClientFrame) {
		if (live?.socket?.readyState === OPEN) live.socket.send(JSON.stringify(frame));
	}

	/** Forget the answer to something that is asked again, or no longer asked. */
	function unrefuse(name: string, what: ChannelRefusal['what']) {
		const refused = refusals.get(name);
		if (!refused?.delete(what)) return;
		if (refused.size === 0) refusals.delete(name);
		changed();
	}

	function startFaultTimer() {
		clearTimers(faultTimer);
		faultTimer = timers.setTimeout(() => {
			faultTimer = undefined;
			if (state !== 'connecting' && state !== 'disconnected') return;
			set({
				state: 'suspended',
				error: error ?? new Error('The realtime connection has not been made'),
			});
		}, faultAfterMs);
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
			if (live?.socket?.readyState === OPEN) {
				const attach: AttachFrame = { t: 'attach', channel: name };
				if (epoch !== undefined) attach.epoch = epoch;
				send(attach);
			} else connect();
		}
		return held;
	}

	/** Forget a channel nothing refers to any more; the last one closes the socket. */
	function release(name: string) {
		const held = channels.get(name);
		if (!held || entries.has(name)) return;
		if (held.handlers.size > 0 || held.onLost.size > 0 || held.onNextAttach.size > 0) return;
		channels.delete(name);
		unrefuse(name, 'attach');
		send({ t: 'detach', channel: name });
		closeIfIdle();
	}

	/** Let go of the connect in flight or the socket in use, and of every timer. */
	function stop() {
		const leaving = live;
		live = null;
		clearTimers(retryTimer, connectTimer, heartbeatTimer, pongTimer, faultTimer);
		retryTimer = connectTimer = heartbeatTimer = pongTimer = faultTimer = undefined;
		leaving?.socket?.close(1000);
		for (const held of channels.values()) held.attached = false;
		failures = 0;
		// Nothing is failing for anyone any more.
		set({ state: 'closed', connectionId: undefined, error: null, refusal: null });
	}

	function closeIfIdle() {
		if (!disposed && !wantsAnything()) stop();
	}

	function connect() {
		if (disposed || live || state === 'superseded' || !wantsAnything()) return;
		clearTimers(retryTimer);
		retryTimer = undefined;
		if (state === 'initialized' || state === 'closed') {
			set({ state: 'connecting' });
			startFaultTimer();
		}
		const attempt: Attempt = { socket: null };
		live = attempt;
		connectTimer = timers.setTimeout(
			() => fail(attempt, new Error('The realtime connection did not open in time')),
			connectTimeoutMs,
		);
		// The address is asked for each time: a ticket admits one socket (ADR-0137).
		void Promise.resolve()
			.then(() => options.address())
			.then(
				(address) => open(attempt, address),
				(cause: unknown) =>
					fail(attempt, new Error('The realtime address could not be had', { cause })),
			);
	}

	function open(attempt: Attempt, address: string) {
		if (live !== attempt) return;
		let socket: SocketLike;
		try {
			const Socket = options.WebSocket ?? runtime.WebSocket;
			if (!Socket) throw new Error('This runtime has no WebSocket: pass `WebSocket`');
			socket = new Socket(withClientId(address, clientId));
		} catch (cause) {
			fail(attempt, new Error('The realtime socket could not be opened', { cause }));
			return;
		}
		attempt.socket = socket;

		socket.addEventListener('open', () => {
			if (live !== attempt) return;
			clearTimers(connectTimer);
			connectTimer = undefined;
			// Everything wanted, in one frame: the object replaces what this client's
			// last socket held with it, and answers anew what it refused that one.
			const hello: HelloFrame = {
				t: 'hello',
				attach: [...channels].map(([name, held]) =>
					held.seq === null ? { channel: name } : { channel: name, since: held.seq },
				),
				watch: [...watches.keys()],
				presence: Object.fromEntries(entries),
			};
			if (epoch !== undefined) hello.epoch = epoch;
			send(hello);
			// The first ping's answer is what says this client was let in.
			beat(attempt);
			if (refusals.size > 0) {
				refusals.clear();
				changed();
			}
		});
		socket.addEventListener('message', (event) => {
			if (live === attempt) receive(String(event.data));
		});
		socket.addEventListener('close', (event) => {
			const closedAs =
				event.code === CLOSE_REFUSED
					? `was refused${event.reason ? `: ${event.reason}` : ''}`
					: event.code === CLOSE_SUPERSEDED
						? 'was replaced by a newer socket of this client'
						: `closed${event.code === undefined ? '' : ` (${event.code})`}`;
			fail(attempt, new Error(`The realtime connection ${closedAs}`), event.code ?? 1006);
		});
		// An error is always followed by a close, and the close does the work.
		socket.addEventListener('error', () => {});
	}

	/**
	 * An attempt, or the connection it made, is over. With no `closeCode` the
	 * transport is the one giving up, on a socket whose close may never arrive.
	 */
	function fail(attempt: Attempt, reason: Error, closeCode?: number) {
		if (live !== attempt) return;
		live = null;
		clearTimers(connectTimer, heartbeatTimer, pongTimer);
		connectTimer = heartbeatTimer = pongTimer = undefined;
		if (closeCode === undefined) attempt.socket?.close();
		for (const held of channels.values()) {
			if (held.continuity === 'unstarted') held.continuity = 'lost';
			held.attached = false;
		}

		// Its own newer socket has its place: retrying would only take it back.
		if (closeCode === CLOSE_SUPERSEDED) {
			clearTimers(faultTimer);
			faultTimer = undefined;
			set({ state: 'superseded', connectionId: undefined, error: reason });
			return;
		}

		// A refusal is not a blip: it goes straight to the slow rhythm. A socket the
		// object swept for silence was only slow to ping, and comes straight back.
		if (closeCode === CLOSE_REFUSED) failures = Math.max(failures, QUICK_RETRIES);
		const wait = closeCode === CLOSE_STALE ? 0 : (RETRY_MS[failures] ?? RETRY_CEILING_MS);
		failures += 1;
		if (state === 'connected') startFaultTimer();
		retryTimer = timers.setTimeout(connect, wait);
		set({
			state: state === 'suspended' ? 'suspended' : 'disconnected',
			connectionId: undefined,
			error: reason,
			...(closeCode === CLOSE_REFUSED && { refusal: reason }),
		});
	}

	/** Ping now, and again every `heartbeatMs` for as long as this socket is the one in use. */
	function beat(attempt: Attempt) {
		ping(attempt);
		heartbeatTimer = timers.setTimeout(() => beat(attempt), heartbeatMs);
	}

	function ping(attempt: Attempt) {
		if (attempt.socket?.readyState !== OPEN || pongTimer !== undefined) return;
		attempt.socket.send(PING);
		pongTimer = timers.setTimeout(() => {
			pongTimer = undefined;
			fail(attempt, new Error('The realtime connection stopped answering'));
		}, pongTimeoutMs);
	}

	function checkNow() {
		if (disposed) return;
		if (live) {
			ping(live);
			return;
		}
		if (state === 'superseded') {
			set({ state: 'disconnected' });
			startFaultTimer();
		}
		connect();
	}

	function receive(raw: string) {
		// Anything heard proves the socket alive, and the first thing heard that this
		// client was let in: a refused socket opens too, and closes saying nothing.
		clearTimers(pongTimer);
		pongTimer = undefined;
		if (state !== 'connected') {
			clearTimers(faultTimer);
			faultTimer = undefined;
			set({ state: 'connected', error: null, refusal: null });
		}
		if (raw === PONG) return;
		let frame: ServerFrame;
		try {
			frame = JSON.parse(raw) as ServerFrame;
		} catch {
			return;
		}
		if (typeof frame !== 'object' || frame === null) return;
		// The rhythm starts again only once the object itself has answered. A pong is
		// the runtime's, and an object that fails every socket it accepts must not be
		// retried four times a second for as long as it does.
		failures = 0;

		if (frame.t === 'presence') {
			const watch = watches.get(frame.channel);
			if (!watch) return;
			watch.members = frame.members;
			tell(watch.callbacks, frame.members);
			return;
		}

		if (frame.t === 'refused') {
			const asked = { attach: channels, watch: watches, enter: entries }[frame.what];
			if (!asked?.has(frame.channel)) return;
			const refused = refusals.get(frame.channel) ?? new Set();
			refusals.set(frame.channel, refused);
			if (refused.has(frame.what)) return;
			refused.add(frame.what);
			changed();
			return;
		}

		const held = channels.get(frame.channel);
		if (!held) return;

		if (frame.t === 'attached') {
			epoch = frame.epoch;
			const before = held.continuity;
			const wasAttached = held.attached;
			held.attached = true;
			held.continuity = 'held';
			if (!frame.resumed || held.seq === null) held.seq = frame.seq;
			set({ connectionId: frame.connectionId });
			if (!wasAttached) {
				const waiting = [...held.onNextAttach];
				held.onNextAttach.clear();
				tell(waiting);
			}
			// A first attach on an unbroken connection missed nothing anyone had yet.
			if (!frame.resumed && before !== 'unstarted') tell(held.onLost);
			return;
		}

		if (frame.t !== 'msg') return;
		if (!held.attached || held.seq === null || frame.seq <= held.seq) return;
		// One socket is ordered, so a hole means the object skipped: say so and carry on.
		const hole = frame.seq !== held.seq + 1;
		held.seq = frame.seq;
		if (hole) tell(held.onLost);
		tell(held.handlers.get(frame.name) ?? [], frame.data, frame);
	}

	/** Hold `listener` in `listeners` until the disposer returned is called. */
	function hold<Listener>(
		listeners: Set<Held<Listener>>,
		listener: Listener,
		onDisposed?: () => void,
	) {
		const own = { call: listener };
		listeners.add(own);
		let holding = true;
		return () => {
			if (!holding) return;
			holding = false;
			listeners.delete(own);
			onDisposed?.();
		};
	}

	return {
		clientId,
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
		get refusal() {
			return refusal;
		},
		get channelRefusals() {
			return [...refusals].flatMap(([name, refused]) =>
				[...refused].map((what) => ({ channel: name, what })),
			);
		},
		onChange(listener) {
			return hold(changeListeners, listener);
		},
		checkNow,

		onMessage(name, type, handler) {
			const held = channel(name);
			const handlers = held.handlers.get(type) ?? new Set();
			held.handlers.set(type, handlers);
			return hold(handlers, handler, () => {
				if (handlers.size === 0 && held.handlers.get(type) === handlers) held.handlers.delete(type);
				release(name);
			});
		},

		onContinuityLost(name, handler) {
			return hold(channel(name).onLost, handler, () => release(name));
		},

		onceAttached(name, handler) {
			const held = channel(name);
			if (held.attached) return () => {};
			return hold(held.onNextAttach, handler, () => release(name));
		},

		enterPresence(name, data) {
			entries.set(name, data);
			unrefuse(name, 'enter');
			// On an open socket the attach goes ahead of the entry; on none, the next
			// `hello` carries both.
			channel(name);
			send({ t: 'enter', channel: name, data });
		},

		updatePresence(name, data) {
			if (!entries.has(name)) return;
			entries.set(name, data);
			send({ t: 'update', channel: name, data });
		},

		leavePresence(name) {
			if (!entries.delete(name)) return;
			unrefuse(name, 'enter');
			send({ t: 'leave', channel: name });
			release(name);
		},

		watchPresence(name, callback) {
			let watch = watches.get(name);
			if (!watch) {
				watch = { callbacks: new Set(), members: undefined };
				watches.set(name, watch);
				if (live?.socket?.readyState === OPEN) send({ t: 'watch', channel: name });
				else connect();
			}
			const watching = watch;
			const stopWatching = hold(watching.callbacks, callback, () => {
				if (watching.callbacks.size > 0 || watches.get(name) !== watching) return;
				watches.delete(name);
				unrefuse(name, 'watch');
				send({ t: 'unwatch', channel: name });
				closeIfIdle();
			});
			// The object tells a channel's members when they change, so a watcher that
			// comes later is told what the earlier ones last were.
			const known = watching.members;
			if (known) {
				let waiting = true;
				void Promise.resolve().then(() => {
					if (waiting && watching.members === known) tell([{ call: callback }], known);
				});
				return () => {
					waiting = false;
					stopWatching();
				};
			}
			return stopWatching;
		},

		dispose() {
			if (disposed) return;
			disposed = true;
			stop();
			channels.clear();
			entries.clear();
			watches.clear();
			refusals.clear();
			changeListeners.clear();
		},
	};
}
