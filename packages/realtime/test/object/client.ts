/**
 * A socket as a test holds it: every frame the object sent, in order, and a way
 * to wait for one. It speaks the protocol and nothing more; the client
 * transport is not in it.
 */
import { PING, PONG } from '../../src/protocol.ts';
import type {
	AttachedFrame,
	ClientFrame,
	HelloFrame,
	MessageFrame,
	PresenceFrame,
	PresenceMember,
	RefusedFrame,
	ServerFrame,
} from '../../src/protocol.ts';

export interface Closed {
	code: number;
	reason: string;
}

export interface TestClient {
	/** Every frame received, oldest first. */
	readonly frames: readonly ServerFrame[];
	/** Whether the socket opened: `false` when it closed without opening. */
	readonly opened: Promise<boolean>;
	readonly closed: Promise<Closed>;
	isClosed(): boolean;
	send(frame: ClientFrame): void;
	sendText(text: string): void;
	/** Send a `hello`, and wait until the object has answered all of it. */
	hello(wants?: Omit<HelloFrame, 't'>): Promise<void>;
	/**
	 * Wait until the object has handled everything this socket sent, and this
	 * socket has received everything the object had sent it by then.
	 */
	sync(): Promise<void>;
	/** Send a ping and wait for its pong. */
	ping(): Promise<void>;
	/** How many times the object has asked whether this socket is there. */
	asks(): number;
	/** From now on, answer each ask as a client must: with a ping. */
	answerAsks(): void;
	waitFor<Found>(
		what: string,
		find: (frames: readonly ServerFrame[]) => Found | undefined | null | false,
		timeoutMs?: number,
	): Promise<Found>;
	/** The last answer to an attach of `channel`. */
	attached(channel: string): AttachedFrame | undefined;
	messages(channel: string): MessageFrame[];
	presence(channel: string): PresenceFrame[];
	/** The members of `channel` as last told. */
	members(channel: string): PresenceMember[] | undefined;
	refusals(): RefusedFrame[];
	close(): void;
}

const SYNC = 'sync:';
let syncs = 0;

export function openClient(url: URL): TestClient {
	const socket = new WebSocket(url);
	const frames: ServerFrame[] = [];
	/** The channels whose `sync` was answered: those frames are the test's own, kept out of `frames`. */
	const synced = new Set<string>();
	const waiters = new Set<() => void>();
	const settle = (): void => {
		for (const waiter of [...waiters]) waiter();
	};
	let pongs = 0;
	let answersAsks = false;
	let isClosed = false;

	const opened = new Promise<boolean>((resolve) => {
		socket.addEventListener('open', () => resolve(true), { once: true });
		socket.addEventListener('close', () => resolve(false), { once: true });
	});
	const closed = new Promise<Closed>((resolve) => {
		socket.addEventListener(
			'close',
			({ code, reason }) => {
				isClosed = true;
				resolve({ code, reason });
				settle();
			},
			{ once: true },
		);
	});
	// A socket that never opens errors first; its close says the rest.
	socket.addEventListener('error', () => {});
	socket.addEventListener('message', ({ data }) => {
		if (data === PONG) pongs += 1;
		else {
			const frame = JSON.parse(String(data)) as ServerFrame;
			if (frame.t === 'ask' && answersAsks) socket.send(PING);
			if (frame.t !== 'msg' && frame.t !== 'ask' && frame.channel.startsWith(SYNC))
				synced.add(frame.channel);
			else frames.push(frame);
		}
		settle();
	});

	const sendText = (text: string): void => {
		if (socket.readyState === WebSocket.OPEN) socket.send(text);
		else void opened.then((open) => open && socket.send(text));
	};

	function until(what: string, done: () => boolean, timeoutMs = 5000): Promise<void> {
		return new Promise((resolve, reject) => {
			const finish = (end: () => void): void => {
				clearTimeout(timer);
				waiters.delete(check);
				end();
			};
			const check = (): void => {
				if (done()) finish(resolve);
				else if (isClosed) finish(() => reject(new Error(`closed while waiting for ${what}`)));
			};
			const timer = setTimeout(
				() => finish(() => reject(new Error(`timed out waiting for ${what}`))),
				timeoutMs,
			);
			waiters.add(check);
			check();
		});
	}

	const client: TestClient = {
		frames,
		opened,
		closed,
		isClosed: () => isClosed,
		send: (frame) => sendText(JSON.stringify(frame)),
		sendText,
		async hello(wants = {}) {
			client.send({ t: 'hello', ...wants });
			await client.sync();
		},
		// The object answers a socket's frames in the order it sent them, so the
		// answer to a watch of a channel nobody else names comes after all else.
		// Granted or refused, either is the answer.
		async sync() {
			const channel = `${SYNC}${(syncs += 1)}`;
			client.send({ t: 'watch', channel });
			await until('the object to catch up', () => synced.has(channel));
			client.send({ t: 'unwatch', channel });
		},
		async ping() {
			const before = pongs;
			sendText(PING);
			await until('a pong', () => pongs > before);
		},
		asks: () => frames.filter((frame) => frame.t === 'ask').length,
		answerAsks() {
			answersAsks = true;
		},
		async waitFor(what, find, timeoutMs) {
			let found: unknown;
			await until(what, () => !!(found = find(frames)), timeoutMs);
			return found as never;
		},
		attached: (channel) =>
			frames
				.filter(
					(frame): frame is AttachedFrame => frame.t === 'attached' && frame.channel === channel,
				)
				.at(-1),
		messages: (channel) =>
			frames.filter(
				(frame): frame is MessageFrame => frame.t === 'msg' && frame.channel === channel,
			),
		presence: (channel) =>
			frames.filter(
				(frame): frame is PresenceFrame => frame.t === 'presence' && frame.channel === channel,
			),
		members: (channel) => client.presence(channel).at(-1)?.members,
		refusals: () => frames.filter((frame): frame is RefusedFrame => frame.t === 'refused'),
		close: () => socket.close(),
	};
	return client;
}

export const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));
