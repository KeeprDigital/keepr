/**
 * The frames a client and a scope's object speak over one WebSocket, as JSON
 * text, and the close codes each reads (ADR-0137). A channel is an opaque
 * string to both ends.
 */

/**
 * The heartbeat: a text frame the runtime answers without waking the object.
 * It is also a client's answer to an `ask`.
 */
export const PING = 'ping';
export const PONG = 'pong';

/**
 * The query parameter by which a client names itself across its sockets, so a
 * reconnect replaces the socket it lost and keeps its place in presence.
 */
export const CLIENT_ID_PARAM = 'client';

/** The client's own newer socket replaced this one. */
export const CLOSE_SUPERSEDED = 4000;
/** The client's pings stopped, and it was swept. */
export const CLOSE_STALE = 4001;
/**
 * The socket reached its maximum age. The client comes back at once, and its
 * caller is judged again as any new socket's is.
 */
export const CLOSE_EXPIRED = 4002;
/**
 * Its identity opened more sockets in the scope than the object holds for one,
 * and this was the oldest.
 */
export const CLOSE_CROWDED = 4003;
/** A frame was longer, or a `hello` asked for more, than the object takes. */
export const CLOSE_TOO_LARGE = 4413;
/** The client sent frames faster than the object takes them. */
export const CLOSE_RATE_LIMITED = 4429;
/**
 * The caller may not connect, or may no longer. A page cannot read a refused
 * upgrade's status, so a refusal is an accepted socket closed with this.
 */
export const CLOSE_REFUSED = 4403;

/** One channel a client wants, with the last sequence it heard there, if any. */
export interface AttachRequest {
	channel: string;
	since?: number;
}

/**
 * Everything a client wants, sent as its socket opens. It replaces whatever
 * the socket held, an inherited presence included, and may be sent again to
 * replace it once more. A channel is attached once however often it is named;
 * a `hello` of more entries than the object takes closes the socket with
 * `CLOSE_TOO_LARGE` before any channel's log is read.
 */
export interface HelloFrame {
	t: 'hello';
	/** The epoch its sequences belong to, from an earlier `attached`. */
	epoch?: string;
	attach?: AttachRequest[];
	/** Channels whose presence it watches. */
	watch?: string[];
	/** Its presence data by channel. */
	presence?: Record<string, unknown>;
}

export interface AttachFrame {
	t: 'attach';
	channel: string;
	since?: number;
	epoch?: string;
}

export interface ChannelFrame {
	t: 'detach' | 'watch' | 'unwatch' | 'leave';
	channel: string;
}

export interface PresenceEntryFrame {
	t: 'enter' | 'update';
	channel: string;
	data: unknown;
}

export type ClientFrame = HelloFrame | AttachFrame | ChannelFrame | PresenceEntryFrame;

/**
 * The answer to an attach. `resumed` says everything after `since` follows as
 * replayed messages; otherwise continuity was lost and the consumer re-reads.
 */
export interface AttachedFrame {
	t: 'attached';
	channel: string;
	resumed: boolean;
	/** The channel's last sequence. */
	seq: number;
	/** Names the object's storage: a sequence from another epoch cannot resume. */
	epoch: string;
	/** This socket's id, which a write names so its own message can be told apart. */
	connectionId: string;
}

export interface MessageFrame {
	t: 'msg';
	channel: string;
	seq: number;
	name: string;
	data: unknown;
	/** When the object published it, in epoch milliseconds. */
	sentAt: number;
	/** Set on a message replayed from the log. */
	replayed?: true;
}

export interface PresenceMember {
	connectionId: string;
	data?: unknown;
}

/** A watched channel's members, whole, whenever they change. */
export interface PresenceFrame {
	t: 'presence';
	channel: string;
	members: PresenceMember[];
}

/** The caller may not do `what` on `channel`. What it asked for stays wanted. */
export interface RefusedFrame {
	t: 'refused';
	channel: string;
	what: 'attach' | 'watch' | 'enter';
}

/**
 * The object has heard no ping from this socket for most of the time a member
 * may be silent, and will sweep it unless it answers. The answer is a `PING`,
 * sent from the handler this frame arrives in and not from a timer: a page's
 * timers may be slowed, and its message handlers are not.
 */
export interface AskFrame {
	t: 'ask';
}

export type ServerFrame = AttachedFrame | MessageFrame | PresenceFrame | RefusedFrame | AskFrame;
