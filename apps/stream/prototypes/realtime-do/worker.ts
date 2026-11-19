/**
 * Throwaway prototype for #1295: one Durable Object per Event carrying that
 * Event's channel and every Screen channel under it, with reconnect catch-up
 * and presence. Not the design, only enough of it to measure.
 *
 * Wire protocol (JSON text frames):
 *   server -> client  {t:'attached', channel, resumed, seq, epoch}
 *                     {t:'msg', channel, seq, name, data, sentAt}
 *                     {t:'presence', channel, members:[{connectionId, data}]}
 *   client -> server  {t:'hello', epoch?, attach:[{channel, since?}], watch:[], presence:{}}
 *                       everything the client wants, sent once as its socket opens
 *                     {t:'attach', channel, since?, epoch?}  {t:'detach', channel}
 *                     {t:'watch'|'unwatch', channel}
 *                     {t:'enter'|'update', channel, data}   {t:'leave', channel}
 *                     'ping' (answered 'pong' without waking the object)
 *
 * A socket's channels live in its attachment, not its tags, because tags are
 * fixed at accept and a page's channels are not. A connection names its client
 * (`client=`), so a reconnect replaces the socket it lost and inherits its
 * presence, and no watcher sees it leave; one that says it heartbeats (`hb=1`) is swept from
 * presence once its pings stop.
 */
import { DurableObject } from 'cloudflare:workers';

interface Env {
	EVENT_REALTIME: DurableObjectNamespace<EventRealtime>;
	/** Shared secret for the publish route and the upgrade; the real thing would be a Session or capability. */
	PROTOTYPE_SECRET: string;
	/** Overrides the log's retention, so the probe can outwait it. */
	RETENTION_MS?: string;
	/** Overrides how long a heartbeating socket may be silent before it is swept. */
	STALE_MS?: string;
}

interface Delivery {
	channel: string;
	name: string;
	data: unknown;
}

interface Attachment {
	connectionId: string;
	channels: string[];
	watches: string[];
	presence: Record<string, unknown>;
	/** Set for a client that pings: when it connected, the floor of its last sign of life. */
	heartbeatSince?: number;
}

/** Three missed 15 s pings. */
const DEFAULT_STALE_MS = 45_000;
/** Close codes the client reads: its own newer socket replaced this one; its pings stopped. */
const CLOSE_SUPERSEDED = 4000;
const CLOSE_STALE = 4001;

/** How long a channel's log answers a reconnect: Ably's connection-state recovery window. */
const DEFAULT_RETENTION_MS = 2 * 60 * 1000;

const clientTag = (clientId: string) => `client:${clientId}`;

export class EventRealtime extends DurableObject<Env> {
	private readonly epoch: string;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		ctx.storage.sql.exec(
			`CREATE TABLE IF NOT EXISTS log (
				channel TEXT NOT NULL, seq INTEGER NOT NULL, name TEXT NOT NULL,
				data TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (channel, seq)
			) WITHOUT ROWID`,
		);
		// A wiped object starts a new epoch, so a client holding a seq from the
		// old one is told it lost continuity instead of being replayed nothing.
		let epoch = ctx.storage.kv.get<string>('epoch');
		if (!epoch) {
			epoch = crypto.randomUUID();
			ctx.storage.kv.put('epoch', epoch);
		}
		this.epoch = epoch;
		ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
	}

	private headSeq(channel: string): number {
		const row = this.ctx.storage.sql
			.exec<{ seq: number }>('SELECT MAX(seq) AS seq FROM log WHERE channel = ?', channel)
			.one();
		return row.seq ?? this.ctx.storage.kv.get<number>(`head:${channel}`) ?? 0;
	}

	override async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const channels = (url.searchParams.get('channels') ?? '').split(',').filter(Boolean);
		const watches = (url.searchParams.get('watch') ?? '').split(',').filter(Boolean);
		const since = JSON.parse(url.searchParams.get('since') ?? '{}') as Record<string, number>;
		const sinceEpoch = url.searchParams.get('epoch');

		const clientId = url.searchParams.get('client');

		// The client's earlier socket, if it is still here, is one the client gave
		// up on. The new one stands where it stood in presence until its `hello`
		// says what it wants, so no watcher sees the member leave and come back.
		const inherited: Record<string, unknown> = {};
		if (clientId)
			for (const old of this.ctx.getWebSockets(clientTag(clientId)))
				Object.assign(inherited, this.retire(old, CLOSE_SUPERSEDED, 'superseded'));

		const [client, server] = Object.values(new WebSocketPair());
		this.ctx.acceptWebSocket(server, clientId ? [clientTag(clientId)] : []);
		const attachment: Attachment = {
			connectionId: crypto.randomUUID().slice(0, 13),
			channels: [],
			watches,
			presence: inherited,
			...(url.searchParams.get('hb') === '1' && { heartbeatSince: Date.now() }),
		};
		for (const channel of channels)
			this.attach(server, attachment, channel, since[channel], sinceEpoch);
		server.serializeAttachment(attachment);
		for (const channel of watches) server.send(this.presenceFrame(channel));
		return new Response(null, { status: 101, webSocket: client });
	}

	/** Attach `socket` to `channel`, replaying what it missed when its sequence still joins the log. */
	private attach(
		socket: WebSocket,
		attachment: Attachment,
		channel: string,
		from: number | undefined,
		sinceEpoch: string | null | undefined,
	): void {
		if (!attachment.channels.includes(channel)) attachment.channels.push(channel);
		const head = this.headSeq(channel);
		let resumed = false;
		let replay: { seq: number; name: string; data: string; at: number }[] = [];
		if (from !== undefined && sinceEpoch === this.epoch && from <= head) {
			replay = this.ctx.storage.sql
				.exec<{
					seq: number;
					name: string;
					data: string;
					at: number;
				}>(
					'SELECT seq, name, data, at FROM log WHERE channel = ? AND seq > ? ORDER BY seq',
					channel,
					from,
				)
				.toArray();
			// Resumed only if nothing between `from` and the head was pruned.
			resumed = replay.length === head - from;
		}
		socket.send(
			JSON.stringify({
				t: 'attached',
				channel,
				resumed,
				seq: head,
				epoch: this.epoch,
				connectionId: attachment.connectionId,
			}),
		);
		if (resumed)
			for (const row of replay)
				socket.send(
					JSON.stringify({
						t: 'msg',
						channel,
						seq: row.seq,
						name: row.name,
						data: JSON.parse(row.data),
						sentAt: row.at,
						replayed: true,
					}),
				);
	}

	/** Every open socket with what it holds, read once per call. */
	private sockets(): { socket: WebSocket; attachment: Attachment }[] {
		return this.ctx
			.getWebSockets()
			.map((socket) => ({
				socket,
				attachment: socket.deserializeAttachment() as Attachment | null,
			}))
			.filter((held): held is { socket: WebSocket; attachment: Attachment } => !!held.attachment);
	}

	/**
	 * Take a socket out of fan-out and presence, then close it. Emptying the
	 * attachment first means it counts for nothing even while its close is
	 * unanswered, which is forever for a peer that has vanished. Answers its
	 * presence.
	 */
	private retire(socket: WebSocket, code: number, reason: string): Record<string, unknown> {
		const attachment = socket.deserializeAttachment() as Attachment | null;
		const present = attachment?.presence ?? {};
		socket.serializeAttachment(null);
		try {
			socket.close(code, reason);
		} catch {
			// Already closing.
		}
		return present;
	}

	private staleMs(): number {
		return Number(this.env.STALE_MS ?? DEFAULT_STALE_MS);
	}

	/** A heartbeating socket whose last ping, or whose connect, is older than the limit. */
	private isStale(socket: WebSocket, attachment: Attachment, now: number): boolean {
		if (attachment.heartbeatSince === undefined) return false;
		const pinged = this.ctx.getWebSocketAutoResponseTimestamp(socket)?.getTime() ?? 0;
		return now - Math.max(pinged, attachment.heartbeatSince) > this.staleMs();
	}

	/** While anyone is present, look for members whose pings stopped. */
	override async alarm(): Promise<void> {
		const now = Date.now();
		const leftBy = new Set<string>();
		let present = 0;
		for (const { socket, attachment } of this.sockets()) {
			if (Object.keys(attachment.presence).length === 0) continue;
			if (!this.isStale(socket, attachment, now)) present += 1;
			else
				for (const channel of Object.keys(this.retire(socket, CLOSE_STALE, 'stale')))
					leftBy.add(channel);
		}
		for (const channel of leftBy) this.tellWatchers(channel);
		if (present > 0) await this.ctx.storage.setAlarm(now + this.staleMs() / 2);
	}

	/** The sweep runs only while someone is present. */
	private async ensureSweep(): Promise<void> {
		if ((await this.ctx.storage.getAlarm()) === null)
			await this.ctx.storage.setAlarm(Date.now() + this.staleMs() / 2);
	}

	/** Publish each delivery in order; answers how many sockets each reached. */
	publish(deliveries: Delivery[]): { channel: string; seq: number; recipients: number }[] {
		const now = Date.now();
		const sockets = this.sockets();
		const answers = deliveries.map(({ channel, name, data }) => {
			const seq = this.headSeq(channel) + 1;
			this.ctx.storage.sql.exec(
				'INSERT INTO log (channel, seq, name, data, at) VALUES (?, ?, ?, ?, ?)',
				channel,
				seq,
				name,
				JSON.stringify(data),
				now,
			);
			const frame = JSON.stringify({ t: 'msg', channel, seq, name, data, sentAt: now });
			let recipients = 0;
			for (const { socket, attachment } of sockets) {
				if (!attachment.channels.includes(channel)) continue;
				try {
					socket.send(frame);
					recipients += 1;
				} catch {
					// A socket closing under us: its client catches up when it reconnects.
				}
			}
			return { channel, seq, recipients };
		});
		// Prune on the write path, remembering each channel's head so a pruned-empty
		// channel still knows its last seq.
		for (const { channel, seq } of answers) this.ctx.storage.kv.put(`head:${channel}`, seq);
		const retentionMs = Number(this.env.RETENTION_MS ?? DEFAULT_RETENTION_MS);
		this.ctx.storage.sql.exec('DELETE FROM log WHERE at < ?', now - retentionMs);
		return answers;
	}

	stats(): { sockets: number; logRows: number; epoch: string } {
		return {
			sockets: this.ctx.getWebSockets().length,
			logRows: this.ctx.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM log').one().n,
			epoch: this.epoch,
		};
	}

	private presenceFrame(channel: string, without?: WebSocket): string {
		const members = this.sockets()
			.filter(({ socket, attachment }) => socket !== without && channel in attachment.presence)
			.map(({ attachment }) => ({
				connectionId: attachment.connectionId,
				data: attachment.presence[channel],
			}));
		return JSON.stringify({ t: 'presence', channel, members });
	}

	private tellWatchers(channel: string, without?: WebSocket): void {
		const frame = this.presenceFrame(channel, without);
		for (const { socket, attachment } of this.sockets()) {
			if (!attachment.watches.includes(channel)) continue;
			try {
				socket.send(frame);
			} catch {
				// As above.
			}
		}
	}

	override async webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer): Promise<void> {
		if (typeof raw !== 'string') return;
		const frame = JSON.parse(raw) as {
			t: string;
			channel: string;
			data?: unknown;
			since?: number;
			epoch?: string;
			attach?: { channel: string; since?: number }[];
			watch?: string[];
			presence?: Record<string, unknown>;
		};
		const attachment = socket.deserializeAttachment() as Attachment | null;
		if (!attachment) return;
		if (frame.t === 'hello') {
			const before = attachment.presence;
			attachment.channels = [];
			attachment.watches = frame.watch ?? [];
			for (const { channel, since } of frame.attach ?? [])
				this.attach(socket, attachment, channel, since, frame.epoch);
			attachment.presence = Object.fromEntries(
				Object.entries(frame.presence ?? {}).filter(([channel]) =>
					attachment.channels.includes(channel),
				),
			);
			socket.serializeAttachment(attachment);
			for (const channel of attachment.watches) socket.send(this.presenceFrame(channel));
			for (const channel of new Set([...Object.keys(before), ...Object.keys(attachment.presence)]))
				if (JSON.stringify(before[channel]) !== JSON.stringify(attachment.presence[channel]))
					this.tellWatchers(channel);
			if (Object.keys(attachment.presence).length > 0) await this.ensureSweep();
			return;
		}
		const { channel } = frame;
		let presenceChanged = false;
		if (frame.t === 'attach') this.attach(socket, attachment, channel, frame.since, frame.epoch);
		else if (frame.t === 'watch') {
			if (!attachment.watches.includes(channel)) attachment.watches.push(channel);
		} else if (frame.t === 'unwatch')
			attachment.watches = attachment.watches.filter((watched) => watched !== channel);
		else if (frame.t === 'detach') {
			attachment.channels = attachment.channels.filter((attached) => attached !== channel);
			presenceChanged = channel in attachment.presence;
			delete attachment.presence[channel];
		} else if (!attachment.channels.includes(channel)) return;
		else if (frame.t === 'enter' || frame.t === 'update') {
			attachment.presence[channel] = frame.data;
			presenceChanged = true;
			await this.ensureSweep();
		} else if (frame.t === 'leave') {
			presenceChanged = channel in attachment.presence;
			delete attachment.presence[channel];
		} else return;
		socket.serializeAttachment(attachment);
		if (frame.t === 'watch') socket.send(this.presenceFrame(channel));
		if (presenceChanged) this.tellWatchers(channel);
	}

	override webSocketClose(socket: WebSocket): void {
		const attachment = socket.deserializeAttachment() as Attachment | null;
		for (const channel of Object.keys(attachment?.presence ?? {}))
			this.tellWatchers(channel, socket);
	}

	override webSocketError(socket: WebSocket): void {
		this.webSocketClose(socket);
	}
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const secret = url.searchParams.get('secret') ?? request.headers.get('x-prototype-secret');
		if (!env.PROTOTYPE_SECRET || secret !== env.PROTOTYPE_SECRET) {
			// A browser cannot read a refused upgrade's status, so a refusal it must
			// tell from a dead network is an accepted socket closed with a code.
			if (url.pathname !== '/connect' || request.headers.get('upgrade') !== 'websocket')
				return new Response('Not found', { status: 404 });
			const [client, server] = Object.values(new WebSocketPair());
			server.accept();
			server.close(4403, 'refused');
			return new Response(null, { status: 101, webSocket: client });
		}

		const eventId = url.searchParams.get('event');
		if (!eventId || !/^\d+$/.test(eventId)) return new Response('event required', { status: 400 });
		const stub = env.EVENT_REALTIME.getByName(`event:${eventId}`);

		if (url.pathname === '/connect') {
			if (request.headers.get('upgrade') !== 'websocket')
				return new Response('Expected WebSocket', { status: 426 });
			return stub.fetch(request);
		}
		if (url.pathname === '/publish' && request.method === 'POST') {
			const started = Date.now();
			const answers = await stub.publish((await request.json()) as Delivery[]);
			return Response.json({ answers, rpcMs: Date.now() - started });
		}
		if (url.pathname === '/stats') return Response.json(await stub.stats());
		return new Response('Not found', { status: 404 });
	},
} satisfies ExportedHandler<Env>;
