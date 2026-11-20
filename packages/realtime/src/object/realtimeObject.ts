import { DurableObject } from 'cloudflare:workers';
import { CLOSE_REFUSED, CLOSE_STALE, CLOSE_SUPERSEDED, PING, PONG } from '../protocol.ts';
import type {
	AttachRequest,
	HelloFrame,
	PresenceMember,
	RefusedFrame,
	ServerFrame,
} from '../protocol.ts';
import { isChannel, readClientFrame } from './frames.ts';
import { allows, holdGrant } from './grant.ts';
import type { DisconnectOptions, Grant, HeldGrant } from './grant.ts';
import { refuseSocket, TICKET_HEADER } from './handOff.ts';

/** One message for one channel. */
export interface Delivery {
	channel: string;
	name: string;
	data: unknown;
}

/** What became of a delivery: its sequence on its channel, and the sockets it was sent to. */
export interface PublishAnswer {
	channel: string;
	seq: number;
	recipients: number;
}

/** The object's timings, each in milliseconds. A subclass states the ones it changes. */
export interface RealtimeObjectOptions {
	/** How long a channel's log answers a reattach. */
	retentionMs?: number;
	/** How long a member whose socket closed is held before watchers are told. */
	graceMs?: number;
	/** How long a member's pings may have stopped before it is swept. */
	sweepMs?: number;
	/**
	 * How long a member's pings may have stopped before it is asked whether it is
	 * there. Two thirds of `sweepMs` when left out: two of its three missed pings.
	 */
	askMs?: number;
	/** How long a disconnect goes on turning away the sockets it withdrew. */
	withdrawalMs?: number;
}

export const DEFAULT_RETENTION_MS: number = 2 * 60 * 1000;
export const DEFAULT_GRACE_MS: number = 5000;
/** Three missed pings of a client that sends one every 15 s. */
export const DEFAULT_SWEEP_MS: number = 45_000;
/**
 * Longer than a hand-off takes, from the app's port deciding a grant to the
 * object accepting its socket: a grant decided before a disconnect reaches the
 * object within this of it, or not at all.
 */
export const DEFAULT_WITHDRAWAL_MS: number = 60_000;

/** What a silent member is sent before it is swept. It says nothing else, so it is one text. */
const ASK: string = JSON.stringify({ t: 'ask' } satisfies ServerFrame);

/** Where `disconnectAll` keeps the end of its withdrawal, which every grant is refused until. */
const EVERYONE_WITHDRAWN_UNTIL = 'everyoneWithdrawnUntil';

/** How long a ticket waits for its socket: the upgrade follows it in the same call. */
const TICKET_MS = 10_000;

/** What a socket holds, kept in its attachment so it outlasts the object's sleep. */
interface Attachment extends HeldGrant {
	connectionId: string;
	/** The tag its client's sockets share, when the client named itself. */
	client?: string;
	/** When it was accepted: the floor of its last sign of life. */
	since: number;
	channels: string[];
	watches: string[];
	presence: Record<string, unknown>;
}

interface Open {
	socket: WebSocket;
	attachment: Attachment;
}

/** A grant waiting for its socket. */
interface Admission {
	grant: HeldGrant;
	client?: string;
	until: number;
}

/**
 * A member no socket holds, because its socket closed or a restart closed it:
 * held until its grace period ends or its client returns.
 */
interface HeldMember {
	client: string;
	connectionId: string;
	presence: Record<string, unknown>;
	tags: string[];
}

type HeldRow = { client: string; connection: string; presence: string; tags: string };
type LogRow = { seq: number; name: string; data: string; at: number };

const grantTag = (tag: string): string => `tag:${tag}`;

/** One tag for a client's sockets, and only its own identity's: 256 characters hold neither name. */
async function clientTag(identity: string, clientId: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		'SHA-256',
		new TextEncoder().encode(JSON.stringify([identity, clientId])),
	);
	const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0'));
	return `client:${hex.join('')}`;
}

const same = (one: unknown, other: unknown): boolean =>
	JSON.stringify(one) === JSON.stringify(other);

/**
 * One scope's realtime (ADR-0137): every socket of the scope, a sequence and a
 * catch-up log per channel, and presence. An app's Worker exports it, or a
 * subclass that states other timings, and names one object per scope.
 *
 * A socket's channels, watches, presence and grant live in its attachment, not
 * its tags, because tags are fixed at accept and what a page wants is not. An
 * attachment outlasts the object's sleep and dies with its socket, so a member
 * that could return is also in storage, which a restart leaves.
 */
export class RealtimeObject<Env = unknown> extends DurableObject<Env> {
	readonly #epoch: string;
	readonly #retentionMs: number;
	readonly #graceMs: number;
	readonly #sweepMs: number;
	readonly #askMs: number;
	readonly #withdrawalMs: number;
	/** In memory: a ticket is spent by the request that follows the call that made it. */
	readonly #admissions = new Map<string, Admission>();
	/**
	 * The members asked and not heard from since: each connection id with the last
	 * sign of life it was asked at. In memory, so an ask writes nothing. An object
	 * that slept between a member's ask and its sweep has forgotten it asked; if
	 * anything wakes it in that time it asks once more, which costs a frame.
	 */
	#asked = new Map<string, number>();

	constructor(ctx: DurableObjectState, env: Env, options: RealtimeObjectOptions = {}) {
		super(ctx, env);
		this.#retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
		this.#graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
		this.#sweepMs = options.sweepMs ?? DEFAULT_SWEEP_MS;
		// An ask no earlier than the sweep is never sent: the sweep comes first.
		this.#askMs = Math.min(options.askMs ?? Math.round((this.#sweepMs * 2) / 3), this.#sweepMs);
		this.#withdrawalMs = options.withdrawalMs ?? DEFAULT_WITHDRAWAL_MS;
		ctx.storage.sql.exec(
			`CREATE TABLE IF NOT EXISTS log (
				channel TEXT NOT NULL, seq INTEGER NOT NULL, name TEXT NOT NULL,
				data TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (channel, seq)
			) WITHOUT ROWID`,
		);
		// A channel's last sequence outlives its log, so a pruned channel still counts on.
		ctx.storage.sql.exec(
			'CREATE TABLE IF NOT EXISTS head (channel TEXT PRIMARY KEY, seq INTEGER NOT NULL) WITHOUT ROWID',
		);
		// Each member whose client named itself, written when its presence changes. One
		// whose socket holds it has no `until`; one that is held has the end of its
		// grace period.
		ctx.storage.sql.exec(
			`CREATE TABLE IF NOT EXISTS member (
				client TEXT PRIMARY KEY, connection TEXT NOT NULL, presence TEXT NOT NULL,
				tags TEXT NOT NULL, until INTEGER
			) WITHOUT ROWID`,
		);
		// Each tag a disconnect withdrew, and the tag it spared, until the withdrawal
		// ends. In storage, so the object's sleep or restart does not end it early.
		ctx.storage.sql.exec(
			'CREATE TABLE IF NOT EXISTS withdrawn (tag TEXT PRIMARY KEY, spared TEXT, until INTEGER NOT NULL) WITHOUT ROWID',
		);
		// A wiped object starts a new epoch, so a client holding a sequence from the
		// old one is told it lost continuity instead of being replayed nothing.
		let epoch = ctx.storage.kv.get<string>('epoch');
		if (!epoch) {
			epoch = crypto.randomUUID();
			ctx.storage.kv.put('epoch', epoch);
		}
		this.#epoch = epoch;
		ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
		this.#holdTheLost();
	}

	/**
	 * A restart closes every socket of the scope and tells the object of none.
	 * So when the object starts, a member the storage says a socket holds, whose
	 * client has no socket, is held from now as a closed socket's is. After a
	 * sleep every socket is still here, and nobody is held.
	 */
	#holdTheLost(): void {
		const stored = this.ctx.storage.sql
			.exec<{ client: string }>('SELECT client FROM member WHERE until IS NULL')
			.toArray();
		if (stored.length === 0) return;
		const here = new Set(this.#sockets().map(({ attachment }) => attachment.client));
		const lost = stored.filter(({ client }) => !here.has(client));
		if (lost.length === 0) return;
		const until = Date.now() + this.#graceMs;
		for (const { client } of lost)
			this.ctx.storage.sql.exec('UPDATE member SET until = ? WHERE client = ?', until, client);
		void this.ctx.blockConcurrencyWhile(() => this.#schedule());
	}

	/**
	 * Hold a grant for one socket and answer the ticket its upgrade must carry.
	 * `connectSocket` calls this; an app does not.
	 */
	async admit(grant: Grant, clientId?: string): Promise<string> {
		const held = holdGrant(grant);
		const client = clientId ? await clientTag(grant.identity, clientId) : undefined;
		const now = Date.now();
		for (const [ticket, admission] of this.#admissions)
			if (admission.until <= now) this.#admissions.delete(ticket);
		const ticket = crypto.randomUUID();
		this.#admissions.set(ticket, {
			grant: held,
			until: now + TICKET_MS,
			...(client !== undefined && { client }),
		});
		return ticket;
	}

	/** Accept the socket a ticket admits. Anything else is turned away. */
	override async fetch(request: Request): Promise<Response> {
		const ticket = request.headers.get(TICKET_HEADER);
		const admission = ticket === null ? undefined : this.#admissions.get(ticket);
		if (ticket !== null) this.#admissions.delete(ticket);
		if (
			!admission ||
			admission.until <= Date.now() ||
			request.headers.get('upgrade')?.toLowerCase() !== 'websocket'
		)
			return new Response('A socket reaches this object through connectSocket.', { status: 403 });
		const { grant, client } = admission;
		// Its grant was decided before a disconnect that has since withdrawn it.
		if (this.#isWithdrawn(grant.tags)) return refuseSocket();

		// The client's earlier socket, if it is still here, is one the client gave
		// up on; one that closed is held. The new one stands where that stood, under
		// its connection id, until its `hello` says what it wants, so no watcher sees
		// the member leave and come back.
		const inherited: Record<string, unknown> = {};
		let connectionId: string | undefined;
		if (client !== undefined) {
			for (const earlier of this.ctx.getWebSockets(client)) {
				const was = this.#retire(earlier, CLOSE_SUPERSEDED, 'superseded');
				if (!was) continue;
				Object.assign(inherited, was.presence);
				connectionId = was.connectionId;
			}
			const held = this.#held().find((member) => member.client === client);
			if (held) {
				Object.assign(inherited, held.presence);
				connectionId ??= held.connectionId;
			}
		}
		// It keeps only the places its own grant lets it enter.
		const kept = Object.entries(inherited).filter(([channel]) => allows(grant.enter, channel));
		const left = Object.keys(inherited).filter((channel) => !allows(grant.enter, channel));

		const pair = new WebSocketPair();
		const socket = pair[1];
		this.ctx.acceptWebSocket(socket, [
			...(client === undefined ? [] : [client]),
			...grant.tags.map(grantTag),
		]);
		const attachment: Attachment = {
			...grant,
			connectionId: connectionId ?? crypto.randomUUID(),
			...(client !== undefined && { client }),
			since: Date.now(),
			channels: [],
			watches: [],
			presence: Object.fromEntries(kept),
		};
		if (!this.#keep(socket, attachment)) {
			left.push(...Object.keys(attachment.presence));
			attachment.presence = {};
			socket.serializeAttachment(attachment);
		}
		// The place it stood in is now this socket's, or nobody's.
		if (Object.keys(inherited).length > 0) this.#record(attachment);
		this.#tellWatchers(left);
		if (kept.length > 0) await this.#schedule();
		return new Response(null, { status: 101, webSocket: pair[0] });
	}

	/**
	 * Publish each delivery in order. Answers each one's sequence on its channel,
	 * and how many sockets it was sent to.
	 */
	publish(deliveries: readonly Delivery[]): PublishAnswer[] {
		const now = Date.now();
		const sockets = this.#sockets();
		const answers = deliveries.map(({ channel, name, data = null }) => {
			const { seq } = this.ctx.storage.sql
				.exec<{ seq: number }>(
					`INSERT INTO head (channel, seq) VALUES (?, 1)
					ON CONFLICT (channel) DO UPDATE SET seq = seq + 1 RETURNING seq`,
					channel,
				)
				.one();
			this.ctx.storage.sql.exec(
				'INSERT INTO log (channel, seq, name, data, at) VALUES (?, ?, ?, ?, ?)',
				channel,
				seq,
				name,
				JSON.stringify(data),
				now,
			);
			const frame = JSON.stringify({
				t: 'msg',
				channel,
				seq,
				name,
				data,
				sentAt: now,
			} satisfies ServerFrame);
			let recipients = 0;
			for (const { socket, attachment } of sockets)
				if (attachment.channels.includes(channel) && this.#send(socket, frame)) recipients += 1;
			return { channel, seq, recipients };
		});
		// The log is pruned where it grows.
		this.ctx.storage.sql.exec('DELETE FROM log WHERE at < ?', now - this.#retentionMs);
		return answers;
	}

	/**
	 * Withdraw what the app granted under `tag`: close every socket whose grant
	 * carried it, with `CLOSE_REFUSED`, tell watchers at once, and for
	 * `withdrawalMs` let in no socket whose grant carries it. That last is for
	 * the socket whose grant the app's port decided before this and which
	 * reaches the object after: without it, that socket would outlive what
	 * admitted it. Answers how many sockets it closed.
	 *
	 * A grant that also carries `except` is spared, here and for as long: so an
	 * app that replaces a credential names the holder as `tag` and the new
	 * credential as `except`, and the new one's sockets are let in at once.
	 */
	disconnect(tag: string, { except }: DisconnectOptions = {}): number {
		const now = Date.now();
		this.ctx.storage.sql.exec('DELETE FROM withdrawn WHERE until <= ?', now);
		this.ctx.storage.sql.exec(
			'INSERT OR REPLACE INTO withdrawn (tag, spared, until) VALUES (?, ?, ?)',
			tag,
			except ?? null,
			now + this.#withdrawalMs,
		);
		const spared = (tags: readonly string[]): boolean =>
			except !== undefined && tags.includes(except);
		const left = new Set<string>();
		let closed = 0;
		for (const socket of this.ctx.getWebSockets(grantTag(tag))) {
			if (spared(this.#read(socket)?.tags ?? [])) continue;
			const was = this.#retire(socket, CLOSE_REFUSED, 'refused');
			if (!was) continue;
			closed += 1;
			this.#record({ ...was, presence: {} });
			for (const channel of Object.keys(was.presence)) left.add(channel);
		}
		// A member in its grace period has no socket to close, and no place to keep.
		for (const held of this.#held()) {
			if (!held.tags.includes(tag) || spared(held.tags)) continue;
			this.ctx.storage.sql.exec('DELETE FROM member WHERE client = ?', held.client);
			for (const channel of Object.keys(held.presence)) left.add(channel);
		}
		this.#tellWatchers(left);
		return closed;
	}

	/**
	 * Withdraw everything the app granted in this scope, as `disconnect` does a
	 * tag's, whatever each grant carries: close every socket with
	 * `CLOSE_REFUSED`, end every member's grace period, and for `withdrawalMs`
	 * let in no socket at all. For a scope the app has ended, whose sockets
	 * nothing should hold: with nobody present or held, no alarm is left to
	 * wake the object. Answers how many sockets it closed.
	 */
	async disconnectAll(): Promise<number> {
		this.ctx.storage.kv.put(EVERYONE_WITHDRAWN_UNTIL, Date.now() + this.#withdrawalMs);
		let closed = 0;
		for (const socket of this.ctx.getWebSockets())
			if (this.#retire(socket, CLOSE_REFUSED, 'refused')) closed += 1;
		// Every watcher's socket closed with the rest, so there is nobody to tell.
		this.ctx.storage.sql.exec('DELETE FROM member');
		this.#asked.clear();
		await this.ctx.storage.deleteAlarm();
		return closed;
	}

	/** Whether a disconnect still standing withdrew a grant of `tags`. */
	#isWithdrawn(tags: readonly string[]): boolean {
		if ((this.ctx.storage.kv.get<number>(EVERYONE_WITHDRAWN_UNTIL) ?? 0) > Date.now()) return true;
		if (tags.length === 0) return false;
		return this.ctx.storage.sql
			.exec<{
				tag: string;
				spared: string | null;
			}>('SELECT tag, spared FROM withdrawn WHERE until > ?', Date.now())
			.toArray()
			.some(({ tag, spared }) => tags.includes(tag) && !(spared !== null && tags.includes(spared)));
	}

	override async webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer): Promise<void> {
		if (typeof raw !== 'string') return;
		const attachment = this.#read(socket);
		if (!attachment) return;
		const frame = readClientFrame(raw);
		if (!frame) return;
		if (frame.t === 'hello') return this.#hello(socket, attachment, frame);

		const { channel } = frame;
		const refuse = (what: RefusedFrame['what']): void => {
			this.#send(socket, JSON.stringify({ t: 'refused', channel, what } satisfies ServerFrame));
		};
		switch (frame.t) {
			case 'attach': {
				if (!allows(attachment.hear, channel)) return refuse('attach');
				const answer = this.#attach(attachment, frame, frame.epoch);
				if (!this.#keep(socket, attachment)) return refuse('attach');
				for (const each of answer) this.#send(socket, each);
				return;
			}
			case 'watch': {
				if (!allows(attachment.hear, channel)) return refuse('watch');
				if (!attachment.watches.includes(channel)) attachment.watches.push(channel);
				if (!this.#keep(socket, attachment)) return refuse('watch');
				this.#send(socket, this.#presenceFrame(channel));
				return;
			}
			case 'unwatch': {
				attachment.watches = attachment.watches.filter((watched) => watched !== channel);
				this.#keep(socket, attachment);
				return;
			}
			case 'detach':
			case 'leave': {
				if (frame.t === 'detach')
					attachment.channels = attachment.channels.filter((attached) => attached !== channel);
				const present = Object.hasOwn(attachment.presence, channel);
				delete attachment.presence[channel];
				this.#keep(socket, attachment);
				if (!present) return;
				this.#record(attachment);
				this.#tellWatchers([channel]);
				return;
			}
			case 'enter':
			case 'update': {
				if (!allows(attachment.enter, channel)) return refuse('enter');
				const data = frame.data ?? null;
				const changed =
					!Object.hasOwn(attachment.presence, channel) || !same(attachment.presence[channel], data);
				attachment.presence[channel] = data;
				if (!this.#keep(socket, attachment)) return refuse('enter');
				if (changed) {
					this.#record(attachment);
					this.#tellWatchers([channel]);
				}
				await this.#schedule();
			}
		}
	}

	override async webSocketClose(socket: WebSocket, code: number, reason: string): Promise<void> {
		// The close is answered, or the client waits on it. A code that only says
		// none was given cannot be sent back.
		await this.#closed(this.#retire(socket, code === 1005 || code === 1006 ? 1000 : code, reason));
	}

	override async webSocketError(socket: WebSocket): Promise<void> {
		await this.#closed(this.#retire(socket));
	}

	/**
	 * A closed socket's member is held for the grace period, so a client that
	 * comes straight back is never seen to leave. One that named no client cannot
	 * come back, and watchers are told at once.
	 */
	async #closed(attachment: Attachment | null): Promise<void> {
		const channels = Object.keys(attachment?.presence ?? {});
		if (!attachment || channels.length === 0) return;
		if (attachment.client === undefined || this.#graceMs <= 0) {
			this.#record({ ...attachment, presence: {} });
			return this.#tellWatchers(channels);
		}
		this.#record(attachment, Date.now() + this.#graceMs);
		await this.#schedule();
	}

	/**
	 * Write a client's member to storage, where a restart cannot lose it: what
	 * its socket holds, or with `until`, what is held for it. Called only when
	 * its presence changes, never for a publish. A socket that named no client
	 * cannot return, and is not written.
	 */
	#record(attachment: Attachment, until: number | null = null): void {
		if (attachment.client === undefined) return;
		if (Object.keys(attachment.presence).length === 0) {
			this.ctx.storage.sql.exec('DELETE FROM member WHERE client = ?', attachment.client);
			return;
		}
		this.ctx.storage.sql.exec(
			'INSERT OR REPLACE INTO member (client, connection, presence, tags, until) VALUES (?, ?, ?, ?, ?)',
			attachment.client,
			attachment.connectionId,
			JSON.stringify(attachment.presence),
			JSON.stringify(attachment.tags),
			until,
		);
	}

	/**
	 * Runs only while anyone is present or held: tells watchers of the members
	 * whose grace period ended, asks those whose pings have stopped whether they
	 * are there, and sweeps those whose pings stopped a sweep ago, whose sockets
	 * never closed. A member that answers its ask pings, so it is not swept.
	 */
	override async alarm(): Promise<void> {
		const now = Date.now();
		const left = new Set<string>();
		const ended = this.ctx.storage.sql
			.exec<{
				presence: string;
			}>('DELETE FROM member WHERE until IS NOT NULL AND until <= ? RETURNING presence', now)
			.toArray();
		for (const { presence } of ended)
			for (const channel of Object.keys(JSON.parse(presence) as object)) left.add(channel);
		const asked = new Map<string, number>();
		for (const { socket, attachment } of this.#sockets()) {
			if (Object.keys(attachment.presence).length === 0) continue;
			const seen = this.#lastSeen(socket, attachment);
			if (seen + this.#sweepMs <= now) {
				this.#retire(socket, CLOSE_STALE, 'stale');
				this.#record({ ...attachment, presence: {} });
				for (const channel of Object.keys(attachment.presence)) left.add(channel);
				continue;
			}
			if (seen + this.#askMs > now) continue;
			// Asked once for each silence: an alarm that runs for another member's
			// sake finds this one already asked.
			if (this.#asked.get(attachment.connectionId) !== seen) this.#send(socket, ASK);
			asked.set(attachment.connectionId, seen);
		}
		// Whoever answered, was swept or left is no longer waited on.
		this.#asked = asked;
		this.#tellWatchers(left);
		await this.#schedule();
	}

	/** Everything a client wants, replacing whatever its socket held. */
	async #hello(socket: WebSocket, attachment: Attachment, frame: HelloFrame): Promise<void> {
		const before = attachment.presence;
		const refused: RefusedFrame[] = [];
		const refuse = (channel: string, what: RefusedFrame['what']): void => {
			refused.push({ t: 'refused', channel, what });
		};
		const attach = frame.attach ?? [];
		const watch = frame.watch ?? [];
		const enter = Object.entries(frame.presence ?? {}).filter(([channel]) => isChannel(channel));

		const answers: string[] = [];
		attachment.channels = [];
		for (const request of attach)
			if (allows(attachment.hear, request.channel))
				answers.push(...this.#attach(attachment, request, frame.epoch));
			else refuse(request.channel, 'attach');
		attachment.watches = [];
		for (const channel of new Set(watch))
			if (allows(attachment.hear, channel)) attachment.watches.push(channel);
			else refuse(channel, 'watch');
		attachment.presence = {};
		for (const [channel, data] of enter)
			if (allows(attachment.enter, channel)) attachment.presence[channel] = data ?? null;
			else refuse(channel, 'enter');

		if (!this.#keep(socket, attachment)) {
			// More than a socket can hold: it holds nothing, and is told so of each.
			Object.assign(attachment, { channels: [], watches: [], presence: {} });
			socket.serializeAttachment(attachment);
			answers.length = 0;
			refused.length = 0;
			for (const { channel } of attach) refuse(channel, 'attach');
			for (const channel of watch) refuse(channel, 'watch');
			for (const [channel] of enter) refuse(channel, 'enter');
		}

		const changed = new Set(
			[...Object.keys(before), ...Object.keys(attachment.presence)].filter(
				(channel) =>
					Object.hasOwn(before, channel) !== Object.hasOwn(attachment.presence, channel) ||
					!same(before[channel], attachment.presence[channel]),
			),
		);
		for (const answer of answers) this.#send(socket, answer);
		// A watched channel that changed reaches this socket with every other watcher.
		for (const channel of attachment.watches)
			if (!changed.has(channel)) this.#send(socket, this.#presenceFrame(channel));
		for (const each of refused) this.#send(socket, JSON.stringify(each));
		if (changed.size > 0) this.#record(attachment);
		this.#tellWatchers(changed);
		if (Object.keys(attachment.presence).length > 0) await this.#schedule();
	}

	/**
	 * Attach to a channel, and answer the frames that say so: `attached`, then
	 * what the socket missed when its sequence still joins the log.
	 */
	#attach(attachment: Attachment, request: AttachRequest, epoch: string | undefined): string[] {
		const { channel, since } = request;
		if (!attachment.channels.includes(channel)) attachment.channels.push(channel);
		const head = this.#head(channel);
		let replay: LogRow[] = [];
		let resumed = false;
		if (since !== undefined && epoch === this.#epoch && since <= head) {
			replay = this.ctx.storage.sql
				.exec<LogRow>(
					'SELECT seq, name, data, at FROM log WHERE channel = ? AND seq > ? ORDER BY seq',
					channel,
					since,
				)
				.toArray();
			// Resumed only if nothing between `since` and the head was pruned.
			resumed = replay.length === head - since;
		}
		const frames: ServerFrame[] = [
			{
				t: 'attached',
				channel,
				resumed,
				seq: head,
				epoch: this.#epoch,
				connectionId: attachment.connectionId,
			},
		];
		if (resumed)
			for (const row of replay)
				frames.push({
					t: 'msg',
					channel,
					seq: row.seq,
					name: row.name,
					data: JSON.parse(row.data),
					sentAt: row.at,
					replayed: true,
				});
		return frames.map((frame) => JSON.stringify(frame));
	}

	#head(channel: string): number {
		const rows = this.ctx.storage.sql
			.exec<{ seq: number }>('SELECT seq FROM head WHERE channel = ?', channel)
			.toArray();
		return rows[0]?.seq ?? 0;
	}

	#read(socket: WebSocket): Attachment | null {
		return socket.deserializeAttachment() as Attachment | null;
	}

	/** Every open socket with what it holds, read once per call. */
	#sockets(): Open[] {
		const open: Open[] = [];
		for (const socket of this.ctx.getWebSockets()) {
			const attachment = this.#read(socket);
			if (attachment) open.push({ socket, attachment });
		}
		return open;
	}

	/** Whether the socket now holds `attachment`: the runtime refuses one over 16 KiB. */
	#keep(socket: WebSocket, attachment: Attachment): boolean {
		try {
			socket.serializeAttachment(attachment);
			return true;
		} catch {
			return false;
		}
	}

	/** Whether the frame was sent. A socket closing under us catches up when its client returns. */
	#send(socket: WebSocket, frame: string): boolean {
		try {
			socket.send(frame);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Remove a socket from fan-out and presence and answer what it held, closing
	 * it when given a code. Emptying the attachment first means it counts for
	 * nothing even while its close is unanswered, which is forever for a peer
	 * that has vanished.
	 */
	#retire(socket: WebSocket, code?: number, reason?: string): Attachment | null {
		const attachment = this.#read(socket);
		try {
			socket.serializeAttachment(null);
		} catch {
			// Already gone, and with it what it held.
		}
		try {
			if (code !== undefined) socket.close(code, reason);
		} catch {
			// Already closing.
		}
		return attachment;
	}

	/** The members no socket holds: each in its grace period. */
	#held(): HeldMember[] {
		return this.ctx.storage.sql
			.exec<HeldRow>(
				'SELECT client, connection, presence, tags FROM member WHERE until IS NOT NULL',
			)
			.toArray()
			.map((row) => ({
				client: row.client,
				connectionId: row.connection,
				presence: JSON.parse(row.presence) as Record<string, unknown>,
				tags: JSON.parse(row.tags) as string[],
			}));
	}

	#presenceFrame(channel: string): string {
		const members: PresenceMember[] = [];
		for (const { attachment } of this.#sockets())
			if (Object.hasOwn(attachment.presence, channel))
				members.push({
					connectionId: attachment.connectionId,
					data: attachment.presence[channel],
				});
		for (const held of this.#held())
			if (Object.hasOwn(held.presence, channel))
				members.push({ connectionId: held.connectionId, data: held.presence[channel] });
		return JSON.stringify({ t: 'presence', channel, members } satisfies ServerFrame);
	}

	/** Send each channel's members, whole, to the sockets watching it. */
	#tellWatchers(channels: Iterable<string>): void {
		for (const channel of new Set(channels)) {
			const watchers = this.#sockets().filter(({ attachment }) =>
				attachment.watches.includes(channel),
			);
			if (watchers.length === 0) continue;
			const frame = this.#presenceFrame(channel);
			for (const { socket } of watchers) this.#send(socket, frame);
		}
	}

	/** A socket's last sign of life: its last ping, or its accept. */
	#lastSeen(socket: WebSocket, attachment: Attachment): number {
		const pinged = this.ctx.getWebSocketAutoResponseTimestamp(socket)?.getTime() ?? 0;
		return Math.max(pinged, attachment.since);
	}

	/**
	 * Set the alarm for the first moment a member could need asking or telling
	 * of: a grace period ending, the ask of whoever was heard from longest ago, or
	 * the sweep limit of whoever was asked. With no one present or held there is
	 * nothing to wait for, and no alarm.
	 */
	async #schedule(): Promise<void> {
		let next = this.ctx.storage.sql
			.exec<{ until: number | null }>('SELECT MIN(until) AS until FROM member')
			.one().until;
		for (const { socket, attachment } of this.#sockets()) {
			if (Object.keys(attachment.presence).length === 0) continue;
			const seen = this.#lastSeen(socket, attachment);
			const wasAsked = this.#asked.get(attachment.connectionId) === seen;
			const need = seen + (wasAsked ? this.#sweepMs : this.#askMs);
			next = next === null ? need : Math.min(next, need);
		}
		if (next === null) return;
		const set = await this.ctx.storage.getAlarm();
		if (set === null || set > next) await this.ctx.storage.setAlarm(next);
	}
}
