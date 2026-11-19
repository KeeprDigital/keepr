import { createSocketTransport } from '../../../src/client/index.ts';
import type {
	SocketEvent,
	SocketLike,
	SocketTransport,
	SocketTransportOptions,
} from '../../../src/client/index.ts';
import { PING, PONG } from '../../../src/protocol.ts';
import type {
	AttachedFrame,
	ClientFrame,
	MessageFrame,
	PresenceFrame,
	PresenceMember,
	RefusedFrame,
	ServerFrame,
} from '../../../src/protocol.ts';

/** Lets every settled promise's reactions run: an address is asked for asynchronously. */
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

	/** How many timers are still to run. */
	get pending(): number {
		return this.waiting.size;
	}

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

/** A socket whose other end is the test. */
export class FakeSocket implements SocketLike {
	readonly url: string;
	readyState = 0;
	/** Every text frame the client sent, heartbeat included. */
	readonly sent: string[] = [];
	/** What the client closed it with, once it has. */
	closed: { code: number | undefined } | undefined;
	private readonly listeners = new Map<SocketEventType, ((event: SocketEvent) => void)[]>();

	constructor(url: string) {
		this.url = url;
	}

	addEventListener(type: SocketEventType, listener: (event: SocketEvent) => void): void {
		this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
	}

	send(data: string): void {
		this.sent.push(data);
	}

	close(code?: number): void {
		this.closed = { code };
		this.readyState = 3;
	}

	private emit(type: SocketEventType, event: SocketEvent): void {
		for (const listener of this.listeners.get(type) ?? []) listener(event);
	}

	/** The upgrade is accepted. */
	open(): void {
		this.readyState = 1;
		this.emit('open', {});
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

	/** The frames the client sent, without its pings. */
	get frames(): ClientFrame[] {
		return this.sent.filter((data) => data !== PING).map((data) => JSON.parse(data) as ClientFrame);
	}

	get pings(): number {
		return this.sent.filter((data) => data === PING).length;
	}

	/** The client id the transport put on the address. */
	get clientId(): string | undefined {
		return /[?&]client=([^&]*)/.exec(this.url)?.[1];
	}
}

export function attached(channel: string, answer: Partial<AttachedFrame> = {}): AttachedFrame {
	return {
		t: 'attached',
		channel,
		resumed: false,
		seq: 0,
		epoch: 'epoch-1',
		connectionId: 'connection-1',
		...answer,
	};
}

export function message(
	channel: string,
	seq: number,
	data: unknown = seq,
	rest: Partial<MessageFrame> = {},
): MessageFrame {
	return { t: 'msg', channel, seq, name: 'note', data, sentAt: 0, ...rest };
}

export function presence(channel: string, members: PresenceMember[]): PresenceFrame {
	return { t: 'presence', channel, members };
}

export function refused(channel: string, what: RefusedFrame['what']): RefusedFrame {
	return { t: 'refused', channel, what };
}

/** An address no socket can be opened to: the constructor throws, as on a malformed URL. */
export const UNOPENABLE = 'unopenable:';

export interface Rig {
	readonly transport: SocketTransport;
	readonly clock: FakeClock;
	/** Every socket the transport opened, oldest first. */
	readonly sockets: FakeSocket[];
	/** How many times the transport has asked for its address. */
	asks: () => number;
	/** The newest socket, once the address it waits on has answered. */
	socket: () => Promise<FakeSocket>;
	/** The newest socket accepts its upgrade and answers the first ping: the client is let in. */
	letIn: () => Promise<FakeSocket>;
}

export interface RigOptions extends Partial<Omit<SocketTransportOptions, 'address'>> {
	/** What the nth ask for the address is answered with, counting from 1. */
	answer?: (ask: number) => string | PromiseLike<string>;
}

export function rig({ answer, ...options }: RigOptions = {}): Rig {
	const clock = new FakeClock();
	const sockets: FakeSocket[] = [];
	let asks = 0;
	class Socket extends FakeSocket {
		constructor(url: string) {
			if (url.startsWith(UNOPENABLE)) throw new SyntaxError(`No socket opens to ${url}`);
			super(url);
			sockets.push(this);
		}
	}
	const transport = createSocketTransport({
		address: () => {
			asks += 1;
			return answer ? answer(asks) : `wss://object.test/socket?ask=${asks}`;
		},
		WebSocket: Socket,
		timers: clock,
		...options,
	});
	const socket = async () => {
		await settle();
		const newest = sockets.at(-1);
		if (!newest) throw new Error('The transport has opened no socket');
		return newest;
	};
	return {
		transport,
		clock,
		sockets,
		asks: () => asks,
		socket,
		letIn: async () => {
			const newest = await socket();
			newest.open();
			newest.hear(PONG);
			return newest;
		},
	};
}
