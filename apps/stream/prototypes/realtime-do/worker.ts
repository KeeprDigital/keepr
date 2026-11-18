/**
 * Throwaway prototype for #1295: one Durable Object per Event carrying that
 * Event's channel and every Screen channel under it, with reconnect catch-up
 * and presence. Not the design, only enough of it to measure.
 *
 * Wire protocol (JSON text frames):
 *   server -> client  {t:'attached', channel, resumed, seq, epoch}
 *                     {t:'msg', channel, seq, name, data, sentAt}
 *                     {t:'presence', channel, members:[{connectionId, data}]}
 *   client -> server  {t:'enter'|'update', channel, data}   {t:'leave', channel}
 *                     'ping' (answered 'pong' without waking the object)
 */
import { DurableObject } from 'cloudflare:workers';

interface Env {
	EVENT_REALTIME: DurableObjectNamespace<EventRealtime>;
	/** Shared secret for the publish route and the upgrade; the real thing would be a Session or capability. */
	PROTOTYPE_SECRET: string;
	/** Overrides the log's retention, so the probe can outwait it. */
	RETENTION_MS?: string;
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
}

/** How long a channel's log answers a reconnect: Ably's connection-state recovery window. */
const DEFAULT_RETENTION_MS = 2 * 60 * 1000;

const watchTag = (channel: string) => `watch:${channel}`;

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

		const [client, server] = Object.values(new WebSocketPair());
		this.ctx.acceptWebSocket(server, [...channels, ...watches.map(watchTag)]);
		const attachment: Attachment = {
			connectionId: crypto.randomUUID().slice(0, 13),
			channels,
			watches,
			presence: {},
		};
		server.serializeAttachment(attachment);

		for (const channel of channels) {
			const head = this.headSeq(channel);
			const from = since[channel];
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
			server.send(
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
					server.send(
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
		for (const channel of watches) server.send(this.presenceFrame(channel));
		return new Response(null, { status: 101, webSocket: client });
	}

	/** Publish each delivery in order; answers how many sockets each reached. */
	publish(deliveries: Delivery[]): { channel: string; seq: number; recipients: number }[] {
		const now = Date.now();
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
			for (const socket of this.ctx.getWebSockets(channel)) {
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
		const members = this.ctx
			.getWebSockets(channel)
			.filter((socket) => socket !== without)
			.map((socket) => socket.deserializeAttachment() as Attachment)
			.filter((attachment) => channel in attachment.presence)
			.map(({ connectionId, presence }) => ({ connectionId, data: presence[channel] }));
		return JSON.stringify({ t: 'presence', channel, members });
	}

	private tellWatchers(channel: string, without?: WebSocket): void {
		const frame = this.presenceFrame(channel, without);
		for (const socket of this.ctx.getWebSockets(watchTag(channel))) {
			try {
				socket.send(frame);
			} catch {
				// As above.
			}
		}
	}

	override webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer): void {
		if (typeof raw !== 'string') return;
		const frame = JSON.parse(raw) as { t: string; channel: string; data?: unknown };
		const attachment = socket.deserializeAttachment() as Attachment;
		if (!attachment.channels.includes(frame.channel)) return;
		if (frame.t === 'enter' || frame.t === 'update')
			attachment.presence[frame.channel] = frame.data;
		else if (frame.t === 'leave') delete attachment.presence[frame.channel];
		else return;
		socket.serializeAttachment(attachment);
		this.tellWatchers(frame.channel);
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
		if (!env.PROTOTYPE_SECRET || secret !== env.PROTOTYPE_SECRET)
			return new Response('Not found', { status: 404 });

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
