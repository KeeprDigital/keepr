import { CLIENT_ID_PARAM, CLOSE_REFUSED } from '../protocol.ts';
import type { Grant } from './grant.ts';

/**
 * The header a ticket rides on from `connectSocket` to the object. It says
 * nothing by itself: the grant it stands for went by RPC, which no request
 * from outside can reach.
 */
export const TICKET_HEADER = 'x-realtime-ticket';

/** What `connectSocket` asks of a scope's object: its stub, as the app's binding gives it. */
export interface RealtimeObjectStub {
	admit(grant: Grant, clientId?: string): Promise<string>;
	fetch(request: Request): Promise<Response>;
}

const isUpgrade = (request: Request): boolean =>
	request.headers.get('upgrade')?.toLowerCase() === 'websocket';

/**
 * Hand a socket's upgrade to a scope's object with what the app grants it. This
 * is the only way a socket reaches the object: the grant goes by RPC and
 * answers a ticket for one socket, and the upgrade carries the ticket. The
 * object reads nothing else of the request, so nothing a caller sends is taken
 * for a grant. The client names itself in the URL (`CLIENT_ID_PARAM`).
 */
export async function connectSocket(
	object: RealtimeObjectStub,
	request: Request,
	grant: Grant,
): Promise<Response> {
	if (!isUpgrade(request)) return new Response('Expected a WebSocket upgrade', { status: 426 });
	const clientId = new URL(request.url).searchParams.get(CLIENT_ID_PARAM);
	const ticket = await object.admit(grant, clientId ?? undefined);
	const upgrade = new Request(request);
	upgrade.headers.set(TICKET_HEADER, ticket);
	return object.fetch(upgrade);
}

/**
 * Answer an upgrade the app refuses: an accepted socket closed with
 * `CLOSE_REFUSED`. A page cannot read a refused upgrade's status, so a plain
 * 403 would look to it like a dead network.
 */
export function refuseSocket(): Response {
	const pair = new WebSocketPair();
	pair[1].accept();
	pair[1].close(CLOSE_REFUSED, 'refused');
	return new Response(null, { status: 101, webSocket: pair[0] });
}
