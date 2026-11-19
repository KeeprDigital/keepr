/**
 * The socket boundary of the realtime transport over an Event's object
 * (`app/modules/realtime-transport/socketTransport.ts`): a socket whose other
 * end is the test, on time that moves only when the test moves it. The object's
 * part is played frame by frame, so a test says what the object answered.
 *
 * A Nuxt suite on this rig takes the shared setup's client transport, which
 * never connects, off first: `vi.unmock('@keepr/realtime/client')`.
 */

import type { PageLike, SocketEvent, SocketLike } from '@keepr/realtime/client';
import type {
	AttachedFrame,
	ClientFrame,
	HelloFrame,
	PresenceMember,
	ServerFrame,
} from '@keepr/realtime/protocol';
import type {
	SocketRealtimeTransport,
	SocketRealtimeTransportOptions,
} from '~/modules/realtime-transport/socketTransport';
import { PING, PONG } from '@keepr/realtime/protocol';
import { createSocketRealtimeTransport } from '~/modules/realtime-transport/socketTransport';

/** Lets every settled promise's reactions run: a socket's address is asked for asynchronously. */
export async function settle(): Promise<void> {
	for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
}

/** Time that moves only when a test moves it. */
export class FakeClock {
	private now = 0;
	private nextHandle = 1;
	private readonly waiting = new Map<number, { at: number; run: () => void }>();

	setTimeout = (run: () => void, ms: number): number => {
		const handle = this.nextHandle++;
		this.waiting.set(handle, { at: this.now + ms, run });
		return handle;
	};

	clearTimeout = (handle: unknown): void => {
		this.waiting.delete(handle as number);
	};

	/** Runs every timer due within `ms`, in order, with promises settled between them. */
	async advance(ms: number): Promise<void> {
		await settle();
		const until = this.now + ms;
		for (;;) {
			let next: { handle: number; at: number; run: () => void } | undefined;
			for (const [handle, timer] of this.waiting)
				if (timer.at <= until && (!next || timer.at < next.at)) next = { handle, ...timer };
			if (!next) break;
			this.now = next.at;
			this.waiting.delete(next.handle);
			next.run();
			await settle();
		}
		this.now = until;
	}
}

type SocketEventType = 'open' | 'message' | 'close' | 'error';

/** A socket whose other end is the test, playing the Event's object. */
export class FakeSocket implements SocketLike {
	readyState = 0;
	/** Every text frame the client sent, heartbeat included. */
	readonly sent: string[] = [];
	/** Whether the client closed it. */
	closed = false;
	private readonly listeners = new Map<SocketEventType, ((event: SocketEvent) => void)[]>();
	private readonly sequences = new Map<string, number>();
	readonly url: string;

	constructor(url: string) {
		this.url = url;
	}

	addEventListener(type: SocketEventType, listener: (event: SocketEvent) => void): void {
		this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
	}

	send(data: string): void {
		this.sent.push(data);
	}

	close(): void {
		this.closed = true;
		this.readyState = 3;
	}

	private emit(type: SocketEventType, event: SocketEvent): void {
		for (const listener of this.listeners.get(type) ?? []) listener(event);
	}

	/** The Event whose address this socket was opened to. */
	get eventId(): number {
		return Number(/\/events\/(\d+)\//.exec(this.url)?.[1]);
	}

	/** The upgrade is accepted, and the first ping answered: the client is let in. */
	letIn(): this {
		this.readyState = 1;
		this.emit('open', {});
		this.hear(PONG);
		return this;
	}

	/** The object, or the runtime answering a ping, sends a frame. */
	hear(frame: ServerFrame | typeof PONG): void {
		this.emit('message', { data: typeof frame === 'string' ? frame : JSON.stringify(frame) });
	}

	/** The socket closes from the far end, or the connection fails. */
	drop(code = 1006, reason = ''): void {
		this.readyState = 3;
		this.emit('close', { code, reason });
	}

	/** The object answers an attach: a first one, or one that did not resume, unless `answer` says so. */
	attach(channel: string, answer: Partial<AttachedFrame> = {}): this {
		const frame: AttachedFrame = {
			t: 'attached',
			channel,
			resumed: false,
			seq: this.sequences.get(channel) ?? 0,
			epoch: 'epoch-1',
			connectionId: 'connection-1',
			...answer,
		};
		this.sequences.set(channel, frame.seq);
		this.hear(frame);
		return this;
	}

	/** The object publishes `data` as `name` on `channel`, at the channel's next sequence unless `seq` is given. */
	publish(channel: string, name: string, data: unknown = {}, seq?: number): void {
		const next = seq ?? (this.sequences.get(channel) ?? 0) + 1;
		this.sequences.set(channel, next);
		this.hear({ t: 'msg', channel, seq: next, name, data, sentAt: 0 });
	}

	/** The object tells a watched channel's members, whole. */
	members(channel: string, members: PresenceMember[]): void {
		this.hear({ t: 'presence', channel, members });
	}

	/** The frames the client sent, without its pings. */
	get frames(): ClientFrame[] {
		return this.sent.filter((data) => data !== PING).map((data) => JSON.parse(data) as ClientFrame);
	}

	/** What the client said it wants as this socket opened. */
	get hello(): HelloFrame | undefined {
		return this.frames.find((frame): frame is HelloFrame => frame.t === 'hello');
	}

	get pings(): number {
		return this.sent.filter((data) => data === PING).length;
	}
}

/** A page that says it came `online` when the test says so. */
export function fakePage() {
	const listeners = new Set<() => void>();
	const page: PageLike = {
		addEventListener: (type, listener) => {
			if (type === 'online') listeners.add(listener);
		},
		removeEventListener: (_, listener) => {
			listeners.delete(listener);
		},
	};
	return {
		page,
		online() {
			for (const listener of [...listeners]) listener();
		},
		/** How many listeners the page still holds for coming online. */
		listening: () => listeners.size,
	};
}

export interface SocketRealtimeRig {
	readonly realtime: SocketRealtimeTransport;
	readonly clock: FakeClock;
	/** Every socket opened, oldest first. */
	readonly sockets: FakeSocket[];
	/** The Event of each address asked for, oldest first. */
	readonly asked: number[];
	/** The page comes online. */
	online: () => void;
	/** How many listeners the page still holds for coming online. */
	listening: () => number;
	/** The newest socket, of `eventId` when given, once the address it waits on has answered. */
	socket: (eventId?: number) => Promise<FakeSocket>;
	/** That socket, let in, with each of `channels` attached for the first time. */
	open: (eventId?: number, ...channels: string[]) => Promise<FakeSocket>;
}

/** The realtime transport over an Event's object, on a fake socket, clock and page. */
export function socketRealtimeRig(
	options: Partial<Pick<SocketRealtimeTransportOptions, 'address'>> = {},
): SocketRealtimeRig {
	const clock = new FakeClock();
	const sockets: FakeSocket[] = [];
	const asked: number[] = [];
	const { page, online, listening } = fakePage();
	class Socket extends FakeSocket {
		constructor(url: string) {
			super(url);
			sockets.push(this);
		}
	}
	const realtime = createSocketRealtimeTransport({
		address: (eventId) => {
			asked.push(eventId);
			return options.address?.(eventId) ?? `wss://stream.test/events/${eventId}/realtime`;
		},
		socket: { WebSocket: Socket, timers: clock },
		page,
	});
	const socket = async (eventId?: number) => {
		await settle();
		const newest = sockets.findLast((each) => eventId === undefined || each.eventId === eventId);
		if (!newest) throw new Error('The transport has opened no such socket');
		return newest;
	};
	return {
		realtime,
		clock,
		sockets,
		asked,
		online,
		listening,
		socket,
		open: async (eventId, ...channels) => {
			const newest = (await socket(eventId)).letIn();
			for (const channel of channels) newest.attach(channel);
			return newest;
		},
	};
}
