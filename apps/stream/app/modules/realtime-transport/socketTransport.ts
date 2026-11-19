import type { PageLike, SocketTransport, SocketTransportOptions } from '@keepr/realtime/client';
import type { MessageType } from '~~/shared/types/messages';
import type {
	MessageData,
	RealtimeConnectionState,
	RealtimeHandler,
	RealtimePresenceCallback,
	RealtimePresenceData,
	RealtimePresenceMessage,
	RealtimeRoomHandlers,
	RealtimeTransport,
} from '~/types/realtime';
import { checkOnPageEvents, createSocketTransport } from '@keepr/realtime/client';
import { shallowRef } from 'vue';
import { realtimeChannelEventId } from '~~/shared/utils/realtimeChannels';

type Unsubscribe = () => void;

export interface SocketRealtimeTransportOptions {
	/**
	 * The address of one Event's socket. Asked for on every connect and waited
	 * for, so a Screen Output can fetch a ticket for each socket. One that rejects
	 * with `RefusedError` says this client was refused, which `tokenError` reports.
	 */
	address: (eventId: number) => string | PromiseLike<string>;
	/** What each Event's client transport is made with besides: a test's socket, clock and timings. */
	socket?: Omit<SocketTransportOptions, 'address'>;
	/** The page whose `online` and `visibilitychange` cut the wait before a retry. The runtime's own when not given. */
	page?: PageLike;
}

export interface SocketRealtimeTransport extends RealtimeTransport {
	/** End every Event's socket and every Realtime Subscription, as a page going away does. */
	dispose: () => void;
}

/** One Event's client transport, with what this adapter keeps beside it. */
interface EventSocket {
	readonly transport: SocketTransport;
	readonly stopCheckingOnPageEvents: () => void;
	/** The error last reported for the channels its object refused, kept while they are the same. */
	channelRefusal: Error | null;
}

/**
 * An id no other page will have. `crypto.randomUUID` is missing on a page served
 * over plain HTTP, where `getRandomValues` is not.
 */
function randomId(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * The realtime transport over a Durable Object per Event (ADR-0137): the
 * `RealtimeTransport` port, answered by one client transport of
 * `@keepr/realtime` per Event.
 *
 * A channel names its Event, so each Realtime Subscription goes to that
 * Event's socket. Holding a subscription through a failure, reconnecting and
 * catching up are the client transport's own (ADR-0023); this owns only what
 * the port says in Stream Keepr's terms:
 *
 * - **What it reports is the Event last asked for.** A page is on one Event;
 *   while it moves to another, the one it leaves closes behind it.
 * - **The Event the page is on keeps its socket**, by the client transport's
 *   hold, though for a moment the page asks nothing of it: a component swapped,
 *   a Screen Output changing Screen. Each socket is asked its address, which for
 *   a Screen Output is a ticket fetched. The page is on an Event from the first
 *   thing asked of it, its room included, until it asks something of another
 *   Event, leaves that Event's room for none, or goes away. An Event it has left
 *   closes its socket with the last thing still asked there, and keeps its
 *   client transport for a return.
 * - **A page on no Event is standing by**, `initialized`, where the client
 *   transport says `closed`: it has lost nothing. Only `dispose` reports
 *   `closed`. `suspended` is the client transport's fault, reported once it has
 *   had no connection for 8 s.
 * - **`tokenError` is the refusal**: of the socket itself, or of a channel by
 *   the object. A network that does not answer is never one. A refused socket's
 *   stands while the page is on its Event, whatever it asks there.
 * - **`connectionId` is this page's own id**, made once: a write names it and
 *   the echo filter compares (`useRealtimeMessageGate`). Not the object's id for
 *   a socket, which a reconnect replaces and no socket has before it attaches:
 *   by that, a page would take its own write made around a blip for another's.
 */
export function createSocketRealtimeTransport(
	options: SocketRealtimeTransportOptions,
): SocketRealtimeTransport {
	const pageId = randomId();
	const sockets = new Map<number, EventSocket>();
	/** The Event last asked for, whose socket the port reports. */
	let current: EventSocket | null = null;
	/** The Event the page is on, and what ends the hold that keeps its socket. */
	let stayed: { readonly socket: EventSocket; readonly release: () => void } | null = null;
	let disposed = false;
	/** Read by every reported value and written when any may have changed, so each is reactive. */
	const reported = shallowRef(0);

	const roomHandlers = new Map<string, Map<MessageType, RealtimeHandler<any>>>();
	const roomSubscriptions = new Map<string, Unsubscribe[]>();
	let currentRoom: string | null = null;

	function report() {
		reported.value += 1;
	}

	/** The socket of the Event `channel` names, if it has one: nothing is made and nothing moves. */
	function socketOf(channel: string): EventSocket | null {
		const eventId = realtimeChannelEventId(channel);
		return (eventId == null ? undefined : sockets.get(eventId)) ?? null;
	}

	/** The page is on `socket`'s Event, or on none: hold that socket open, and let go of the one it was on. */
	function stayOn(socket: EventSocket | null) {
		if (stayed?.socket === socket) return;
		const left = stayed;
		stayed = socket && { socket, release: socket.transport.hold() };
		left?.release();
	}

	/**
	 * Ask something new of the socket of the Event `channel` names. The page is on
	 * that Event from then, and not before: what it reports never passes through
	 * an Event's socket that nothing has been asked of yet.
	 */
	function ask<Answer>(channel: string, of: (socket: SocketTransport) => Answer): Answer | null {
		if (disposed) return null;
		const eventId = realtimeChannelEventId(channel);
		if (eventId == null) {
			// An object is an Event's, so there is nowhere to hear this.
			console.warn(`Realtime channel "${channel}" names no Event, so nothing is heard on it`);
			return null;
		}
		let socket = sockets.get(eventId);
		if (!socket) {
			const transport = createSocketTransport({
				...options.socket,
				address: () => options.address(eventId),
			});
			socket = {
				transport,
				stopCheckingOnPageEvents: checkOnPageEvents(transport, options.page),
				channelRefusal: null,
			};
			sockets.set(eventId, socket);
			transport.onChange(report);
		}
		const answer = of(socket.transport);
		stayOn(socket);
		if (current !== socket) {
			current = socket;
			report();
		}
		return answer;
	}

	function connectionState(): RealtimeConnectionState['connectionState'] {
		void reported.value;
		if (disposed) return 'closed';
		const state = current?.transport.connectionState ?? 'initialized';
		return state === 'closed' ? 'initialized' : state;
	}

	/** Why the Event's object will not let this client hear, enter or watch something it still asks for. */
	function channelRefusal(socket: EventSocket): Error | null {
		const refused = socket.transport.channelRefusals;
		if (refused.length === 0) return (socket.channelRefusal = null);
		const message = `Realtime refused ${refused
			.map(({ channel, what }) => `${what} on ${channel}`)
			.join(', ')}`;
		if (socket.channelRefusal?.message !== message) socket.channelRefusal = new Error(message);
		return socket.channelRefusal;
	}

	function hear<T extends MessageType>(
		channel: string,
		type: T,
		handler: RealtimeHandler<T>,
	): Unsubscribe {
		return (
			ask(channel, (socket) =>
				socket.onMessage(channel, type, (data, frame) =>
					// The server publishes a message whole, as `createMessage` builds it.
					handler(data as MessageData<T>, frame),
				),
			) ?? (() => {})
		);
	}

	function leaveRoom(owner: string) {
		for (const unsubscribe of roomSubscriptions.get(owner) ?? []) unsubscribe();
		roomSubscriptions.delete(owner);
	}

	function joinRoom(owner: string) {
		const room = currentRoom;
		const handlers = roomHandlers.get(owner);
		if (!room || !handlers) return;
		roomSubscriptions.set(
			owner,
			[...handlers].map(([type, handler]) => hear(room, type, handler)),
		);
	}

	function offRoom(owner: string) {
		leaveRoom(owner);
		roomHandlers.delete(owner);
	}

	return {
		connectionId: pageId,
		get connectionState() {
			return connectionState();
		},
		get isConnected() {
			return connectionState() === 'connected';
		},
		get error() {
			void reported.value;
			return current?.transport.error ?? null;
		},
		get tokenError() {
			void reported.value;
			if (!current) return null;
			return current.transport.refusal ?? channelRefusal(current);
		},

		setRoom(room) {
			if (currentRoom === room) return;
			const left = [...roomSubscriptions.values()].flat();
			const leftRoom = currentRoom;
			roomSubscriptions.clear();
			currentRoom = room;
			if (room) {
				for (const owner of roomHandlers.keys()) joinRoom(owner);
				// The room is declared intent: the page is on its Event before any handler is.
				ask(room, () => {});
			}
			// Left only once the new room is joined, so a move within an Event keeps its socket.
			for (const unsubscribe of left) unsubscribe();
			// In no room, the page has left the Event its room was in.
			if (!room && leftRoom && stayed?.socket === socketOf(leftRoom)) stayOn(null);
		},

		onRoom(owner, handlers: Partial<RealtimeRoomHandlers>) {
			offRoom(owner);
			roomHandlers.set(
				owner,
				new Map(
					Object.entries(handlers).filter(
						(entry): entry is [MessageType, RealtimeHandler<any>] => entry[1] !== undefined,
					),
				),
			);
			joinRoom(owner);
		},

		offRoom,

		onChannel: hear,

		onContinuityLost(channel, handler) {
			return ask(channel, (socket) => socket.onContinuityLost(channel, handler)) ?? (() => {});
		},

		onceAttached(channel, handler) {
			return ask(channel, (socket) => socket.onceAttached(channel, handler)) ?? (() => {});
		},

		// The client transport holds an entry it cannot make yet, so none of these
		// waits on a socket.
		async enterPresence(channel, data) {
			ask(channel, (socket) => socket.enterPresence(channel, data));
		},

		async leavePresence(channel) {
			socketOf(channel)?.transport.leavePresence(channel);
		},

		async updatePresence(channel, data) {
			socketOf(channel)?.transport.updatePresence(channel, data);
		},

		watchPresence<Data extends RealtimePresenceData>(
			channel: string,
			callback: RealtimePresenceCallback<Data>,
		) {
			return (
				ask(channel, (socket) =>
					socket.watchPresence(channel, (members) =>
						// The one place the presence payload is asserted rather than checked: the
						// wire carries whatever a member entered with. Declared partial, so every
						// reader still has to look.
						callback(members as RealtimePresenceMessage<Data>[]),
					),
				) ?? (() => {})
			);
		},

		dispose() {
			if (disposed) return;
			disposed = true;
			for (const socket of sockets.values()) {
				socket.stopCheckingOnPageEvents();
				socket.transport.dispose();
			}
			sockets.clear();
			roomHandlers.clear();
			roomSubscriptions.clear();
			current = null;
			stayed = null;
			currentRoom = null;
			report();
		},
	};
}
