import type { SocketConstructor, SocketTransport } from '@keepr/realtime/client';
import { createSocketTransport } from '@keepr/realtime/client';
import { LOAD_TOLERANT_WAIT_MS } from '@keepr/nuxt-layer/test/helpers/loadTolerantBounds';
import { anonymousFetch, url } from './client';
import { INTEGRATION_OPERATOR_COOKIE, INTEGRATION_SIGNED_OUT_COOKIE } from './environment';

/**
 * Hearing realtime as a page of this server does: a socket on the Event's
 * object, opened by the client transport the app's own pages use
 * (`@keepr/realtime/client`), with what a browser would send (ADR-0137,
 * ADR-0142). No key and no service besides the server under test: the object
 * is in the realtime dev Worker the server started beside itself.
 *
 * A suite follows a channel, makes the app's own write, and asks what was
 * heard. Nothing publishes for a test: what is heard is what the write
 * announced.
 */

/** The origin of the server this worker tests, as its own pages name it. */
export function serverOrigin(): string {
	return new URL(url('/')).origin;
}

/** What an Operator's page of this server sends with its socket: its Session, and where it was opened from. */
export function operatorPage(): Record<string, string> {
	return { cookie: INTEGRATION_OPERATOR_COOKIE, origin: serverOrigin() };
}

/** The address of a socket on this server, with `query` as its question. */
export function realtimeSocketUrl(query: Record<string, string | number>): string {
	return `${url('/realtime/socket').replace('http', 'ws')}?${new URLSearchParams(
		Object.entries(query).map(([name, value]) => [name, String(value)]),
	)}`;
}

/** Wait for `condition`, or fail saying `what` never came. */
export async function until(
	what: string,
	condition: () => boolean,
	timeoutMs = LOAD_TOLERANT_WAIT_MS,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!condition()) {
		if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}

/**
 * A page's socket by the client transport, with the headers its browser would
 * send. The caller disposes it.
 */
export function connectRealtime(
	address: () => string | Promise<string>,
	headers: Record<string, string> = {},
): SocketTransport {
	const Socket = class extends WebSocket {
		constructor(address: string) {
			// Node's WebSocket takes headers; a browser's sends its own.
			super(address, { headers } as never);
		}
	} as SocketConstructor;
	return createSocketTransport({ address, WebSocket: Socket });
}

/**
 * Ask for a Realtime Ticket as a Screen Output does: its capability, and no
 * Session. Answers the ticket, or throws with the route's status.
 */
export async function realtimeTicket(eventId: number, capability: string): Promise<string> {
	const response = await anonymousFetch(`/api/realtime/ticket?eventId=${eventId}`, {
		method: 'POST',
		headers: { cookie: INTEGRATION_SIGNED_OUT_COOKIE, authorization: `Bearer ${capability}` },
	});
	if (!response.ok) throw new Error(`No Realtime Ticket: the route answered ${response.status}`);
	return ((await response.json()) as { ticket: string }).ticket;
}

/** One message as it was heard: its name, and the message whole, as the server built it. */
export interface HeardMessage {
	name: string;
	data: any;
}

export interface RealtimeFollower {
	/** Everything heard so far, oldest first. */
	readonly heard: readonly HeardMessage[];
	/**
	 * The first message named `name` that `matches`, whether it was heard before
	 * this was asked or arrives after: nothing rests on how many arrive or in
	 * which order.
	 */
	hear: (name: string, matches?: (data: any) => boolean) => Promise<any>;
	/** End the socket. */
	stop: () => void;
}

/** Follow `names` on `channel` over `transport`, once the Event's object has attached it. */
async function follow(
	transport: SocketTransport,
	channel: string,
	names: readonly string[],
): Promise<RealtimeFollower> {
	const heard: HeardMessage[] = [];
	let attached = false;
	transport.onceAttached(channel, () => {
		attached = true;
	});
	for (const name of names)
		transport.onMessage(channel, name, (data) => {
			heard.push({ name, data });
		});

	const refusal = () =>
		transport.refusal?.message ??
		transport.channelRefusals.map(({ what, channel: refused }) => `${what} on ${refused}`)[0];
	try {
		await until(`${channel} to attach`, () => attached || refusal() !== undefined);
		if (!attached) throw new Error(`Realtime refused this follower: ${refusal()}`);
	} catch (error) {
		transport.dispose();
		throw error;
	}

	return {
		heard,
		async hear(name, matches = () => true) {
			if (!names.includes(name))
				throw new Error(`This follower listens for ${names.join(', ')}, not ${name}`);
			let found: HeardMessage | undefined;
			await until(`${name} on ${channel}`, () => {
				found = heard.find((message) => message.name === name && matches(message.data));
				return found !== undefined;
			});
			return found!.data;
		},
		stop: () => transport.dispose(),
	};
}

/**
 * Follow `names` on a channel of `eventId` as a signed-in Operator's page: its
 * Event's channel, or one of its Screens'.
 */
export async function followAsOperator(
	eventId: number,
	channel: string,
	names: readonly string[],
): Promise<RealtimeFollower> {
	const transport = connectRealtime(() => realtimeSocketUrl({ eventId }), operatorPage());
	return await follow(transport, channel, names);
}

/**
 * Follow `names` on a Screen's channel as its Screen Output: no Session, a
 * Realtime Ticket for each socket, given for `capability`.
 */
export async function followAsScreenOutput(
	eventId: number,
	capability: string,
	channel: string,
	names: readonly string[],
): Promise<RealtimeFollower> {
	const transport = connectRealtime(async () =>
		realtimeSocketUrl({ eventId, ticket: await realtimeTicket(eventId, capability) }),
	);
	return await follow(transport, channel, names);
}
