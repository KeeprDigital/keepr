/**
 * The object's tests run against the real class in local `workerd`: Wrangler's
 * test harness builds the test Worker (`worker/index.ts`) and serves it on a
 * free port, with storage it throws away. No credential, nothing remote.
 */
import { randomUUID } from 'node:crypto';
import { createTestHarness } from 'wrangler';
import type { DisconnectOptions, Grant } from '../../src/object/grant.ts';
import { CLIENT_ID_PARAM } from '../../src/protocol.ts';
import { openClient } from './client.ts';
import type { TestClient } from './client.ts';

/** The test Worker's bindings: the class as exported, at its defaults, and under each brief timing. */
export type Binding =
	| 'PLAIN'
	| 'DEFAULTS'
	| 'BRIEF_LOG'
	| 'BRIEF_GRACE'
	| 'BRIEF_SWEEP'
	| 'BRIEF_ASK'
	| 'BRIEF_WITHDRAWAL';

export interface Delivery {
	channel: string;
	name: string;
	data: unknown;
}

export interface PublishAnswer {
	channel: string;
	seq: number;
	recipients: number;
}

/** A grant that lets its socket do anything, for a test that is not about the grant. */
export const anyone: Grant = { identity: 'anyone', hear: ['*'], enter: ['*'] };

export interface ConnectOptions {
	/** The client id the socket names itself by. Without one it is no client's. */
	client?: string;
	/** `bare` sends the request straight to the object, as no app does. */
	door?: 'connect' | 'bare';
}

/** A ticket as `admit` answers it, carried to the object as `connectSocket` carries its own. */
export interface Ticketed {
	readonly ticket: string;
	connect(): TestClient;
	/** The same, asked for no socket: a plain request. */
	request(): Promise<Response>;
}

/** One scope's object, which no other test shares. */
export interface Scope {
	/** A socket the Worker hands to the object with `grant`, or refuses when given `null`. */
	connect(grant?: Grant | null, options?: ConnectOptions): TestClient;
	/** The address of that door, for a client that opens its own socket. */
	address(grant?: Grant | null): string;
	/** The same door, asked for no socket: a plain request. */
	request(grant?: Grant): Promise<Response>;
	publish(...deliveries: Delivery[]): Promise<PublishAnswer[]>;
	disconnect(tag: string, options?: DisconnectOptions): Promise<number>;
	/** Ask the object for a ticket, as `connectSocket` does, and hold it instead of using it. */
	admit(grant?: Grant): Promise<Ticketed>;
	/** A ticket another scope's object answered, carried to this one. */
	carry(ticket: Ticketed): Ticketed;
	/** Any other method of the object, by RPC. */
	call<Answer>(method: string, ...args: unknown[]): Promise<Answer>;
	/** Put the object to sleep as the runtime does, its sockets kept. */
	hibernate(): Promise<void>;
	/** Stop the object and close its sockets, so it starts again from its storage. */
	restart(): Promise<void>;
}

export interface Server {
	scope(binding?: Binding): Scope;
	/** Close every socket the tests opened. */
	closeSockets(): void;
	close(): Promise<void>;
}

export async function startServer(): Promise<Server> {
	const harness = createTestHarness({
		root: import.meta.dirname,
		workers: [{ configPath: './worker/wrangler.jsonc' }],
	});
	const { url: origin } = await harness.listen();
	const clients = new Set<TestClient>();

	return {
		scope(binding = 'DEFAULTS') {
			const name = randomUUID();
			const call = async <Answer>(method: string, ...args: unknown[]): Promise<Answer> => {
				const response = await fetch(new URL(`/call/${binding}/${name}/${method}`, origin), {
					method: 'POST',
					body: JSON.stringify(args),
				});
				if (!response.ok)
					throw new Error(`${method} answered ${response.status}: ${await response.text()}`);
				return (await response.json()) as Answer;
			};
			const evict = (webSockets: 'hibernate' | 'close'): Promise<void> =>
				harness.getWorker().evictDurableObject(binding, { name, webSockets });
			const door = (which: string, grant: Grant | null, client?: string): URL => {
				const url = new URL(`/${which}/${binding}/${name}`, origin);
				if (grant) url.searchParams.set('grant', JSON.stringify(grant));
				if (client) url.searchParams.set(CLIENT_ID_PARAM, client);
				return url;
			};
			const carry = (ticket: string): Ticketed => {
				const url = door('ticket', null);
				url.searchParams.set('ticket', ticket);
				return {
					ticket,
					connect() {
						const socket = new URL(url);
						socket.protocol = 'ws:';
						const opened = openClient(socket);
						clients.add(opened);
						return opened;
					},
					request: () => fetch(url),
				};
			};
			return {
				connect(grant = anyone, { client, door: which = 'connect' } = {}) {
					const url = door(which, grant, client);
					url.protocol = 'ws:';
					const opened = openClient(url);
					clients.add(opened);
					return opened;
				},
				address(grant = anyone) {
					const url = door('connect', grant);
					url.protocol = 'ws:';
					return url.href;
				},
				request: (grant = anyone) => fetch(door('connect', grant)),
				publish: (...deliveries) => call('publish', deliveries),
				disconnect: (tag, options = {}) => call('disconnect', tag, options),
				admit: async (grant = anyone) => carry(await call<string>('admit', grant)),
				carry: ({ ticket }) => carry(ticket),
				call,
				hibernate: () => evict('hibernate'),
				restart: () => evict('close'),
			};
		},
		closeSockets() {
			for (const client of clients) client.close();
			clients.clear();
		},
		close: () => harness.close(),
	};
}
