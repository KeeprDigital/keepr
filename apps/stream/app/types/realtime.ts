import type { CompleteMessage, MessageType } from '~~/shared/types/messages';

export type MessageData<T extends MessageType> = CompleteMessage<T>;

export type RealtimeHandler<T extends MessageType = MessageType> = (
	data: MessageData<T>,
	rawMessage: unknown,
) => void;

export type RealtimeRoomHandlers = {
	[K in MessageType]?: RealtimeHandler<K>;
};

export interface RealtimeConnectionState {
	isConnected: boolean;
	connectionState:
		| 'initialized'
		| 'connecting'
		| 'connected'
		| 'disconnected'
		| 'suspended'
		| 'closing'
		| 'closed'
		| 'failed';
	error: Error | null;
}

export type RealtimePresenceData = object;

/**
 * One member of a presence set, as this application reads one.
 *
 * Only `data` is declared: it is the only part any consumer reads, and the rest of a
 * presence message belongs to whichever transport delivered it. Carrying the payload's
 * own shape here is what keeps it out of every consumer — untyped, each one cast, and
 * a cast is a claim nobody checks.
 *
 * The payload is partial because it is the member's own claim about itself, made when
 * it entered and carried over the wire. A member that entered with an older shape, or
 * with an optional field it had nothing to put in, is a member with fields missing —
 * so a reader has to look, and the type is what makes it.
 */
export interface RealtimePresenceMessage<Data extends RealtimePresenceData = RealtimePresenceData> {
	data?: Partial<Data>;
}

export type RealtimePresenceCallback<Data extends RealtimePresenceData = RealtimePresenceData> = (
	members: RealtimePresenceMessage<Data>[],
) => void;

export interface RealtimeTransport {
	readonly connectionId?: string;
	readonly connectionState: RealtimeConnectionState['connectionState'];
	readonly isConnected: boolean;
	readonly error: Error | null;
	/**
	 * Why this client is not let hear on the Event it is on, when it is not: under
	 * Ably it has no token for the Event, and over an Event's object it was
	 * refused (ADR-0137).
	 *
	 * Separate from `error`, which is about the connection: the connection can be
	 * perfectly connected while nothing on the active Event can be heard. That
	 * state used to exist only as a console warning, so an operator whose Event
	 * switch lost its token saw a healthy-looking page that had silently stopped
	 * receiving anything (#307).
	 *
	 * When it is set and when it ends is each transport's own:
	 *
	 * - **Ably** (`app/plugins/realtime.client.ts`). Set only after the mint's own
	 *   retries are exhausted, so a network blip during an Event switch never puts
	 *   a fault in front of anyone. It then stands while the transport keeps
	 *   re-attempting for the Realtime Subscriptions still waiting, and clears only
	 *   once they have all attached, or when the last of them is disposed (#609,
	 *   ADR-0023).
	 * - **An Event's object** (`app/modules/realtime-transport/socketTransport.ts`).
	 *   Set when the refusal is heard, with no retries first: a refusal is the
	 *   app's answer, which a network blip never gives. A refused socket's stands,
	 *   while the socket is retried, until the client is let in, whatever has
	 *   attached by then, or until the page leaves that Event. A channel the object
	 *   refused has its own, which ends when the next socket asks again or the
	 *   last thing asked of the channel is disposed.
	 */
	readonly tokenError: Error | null;
	setRoom: (room: string | null) => void;
	onRoom: (owner: string, handlers: Partial<RealtimeRoomHandlers>) => void;
	offRoom: (owner: string) => void;
	onChannel: <T extends MessageType>(
		channel: string,
		type: T,
		handler: RealtimeHandler<T>,
	) => () => void;
	/**
	 * Call `handler` each time `channel` is attached again having lost message
	 * continuity, whether the connection dropped or only the channel did. A first
	 * attach is a loss only when the connection dropped before it (ADR-0023).
	 */
	onContinuityLost: (channel: string, handler: () => void) => () => void;
	/**
	 * Call `handler` once, when `channel` next attaches, unless it is attached
	 * already. A consumer that read before its channel attached may have missed what
	 * was published in between, and a first attach on an unbroken connection reports
	 * no continuity loss; it re-reads off this instead (#727, ADR-0023).
	 */
	onceAttached: (channel: string, handler: () => void) => () => void;
	/**
	 * Enter a channel's presence, or hold the entry through a failure and enter it
	 * once the channel's Event recovers (ADR-0023). Resolves once entered or held,
	 * never waiting out an outage.
	 */
	enterPresence: (channel: string, data: RealtimePresenceData) => Promise<void>;
	/** Withdraw the entry: leave if entered, and never enter if still held. */
	leavePresence: (channel: string) => Promise<void>;
	/**
	 * Replace the presence data this client entered a channel with — or, for a held
	 * entry, the data it will enter with. A no-op on a channel with no entry: Ably
	 * treats an update on an unentered channel as an enter, which is
	 * `enterPresence`'s job.
	 */
	updatePresence: (channel: string, data: RealtimePresenceData) => Promise<void>;
	/**
	 * Watch one channel's presence set.
	 *
	 * The payload shape is the caller's to name, because only the caller knows what
	 * enters the channel it is watching. The transport asserts it once, where the wire
	 * really is untyped, rather than leaving every reader to.
	 */
	watchPresence: <Data extends RealtimePresenceData>(
		channel: string,
		callback: RealtimePresenceCallback<Data>,
	) => () => void;
}
