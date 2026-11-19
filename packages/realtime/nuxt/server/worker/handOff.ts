import { connectSocket, refuseSocket } from '../../../src/object/index.ts';
import type { Grant, RealtimeObjectStub } from '../../../src/object/index.ts';
import { TICKET_HEADER } from '../../../src/object/handOff.ts';
import { HAND_OFF_HEADER, PORT_ANSWER_HEADER } from './headers.ts';

/**
 * The hand-off (ADR-0137): a socket's upgrade is put to the app's port, and
 * the port's answer decides whether the socket reaches a scope's object. The
 * built Worker's entry and the Worker beside `nuxt dev` both hand off here, so
 * a socket meets one rule on one path wherever the app runs.
 *
 * Nothing in this file knows Nuxt or Nitro: it runs in the Workers runtime.
 */

/** What the app's port answers for a caller it lets in: the scope, and what the socket may do there. */
export interface Admission {
	/** Names the object that takes the socket. One object per scope. */
	scope: string;
	grant: Grant;
}

/** The port's answer as the hand-off reads it. */
export type PortAnswer =
	/** The port answered: an admission, or `null` to refuse the caller. */
	| { admission: Admission | null }
	/** The port did not answer: the app's own response, which is passed on. */
	| { response: Response };

/** The app's binding, as far as the hand-off reads it. */
export interface ScopeNamespace {
	getByName(scope: string): RealtimeObjectStub;
}

const isUpgrade = (request: Request): boolean =>
	request.headers.get('upgrade')?.toLowerCase() === 'websocket';

/**
 * The request the port is asked with: a plain `GET` of the port's path, with
 * the socket's query and the caller's own headers, so the app reads a cookie,
 * an `Origin` or a ticket as it reads them anywhere. Nothing of the upgrade
 * goes with it, and neither does a header the hand-off itself reads: a caller
 * that sends one gains nothing.
 */
export function portRequest(request: Request, portPath: string): Request {
	const url = new URL(request.url);
	url.pathname = portPath;
	const headers = new Headers(request.headers);
	for (const name of [...headers.keys()])
		if (name === 'upgrade' || name === 'connection' || name.startsWith('sec-websocket-'))
			headers.delete(name);
	headers.delete(TICKET_HEADER);
	headers.delete(HAND_OFF_HEADER);
	return new Request(url, { headers });
}

/** Read the port's answer off the app's response to `portRequest`. */
export async function readPortAnswer(response: Response, portPath: string): Promise<PortAnswer> {
	if (response.headers.get(PORT_ANSWER_HEADER) === null) {
		// A refusal by status, a failure, or no route: the app's to explain.
		if (response.status >= 400) return { response };
		return {
			response: new Response(
				`No port answered at ${portPath}: the app's route there is defineRealtimePort's.`,
				{ status: 500 },
			),
		};
	}
	const { admission } = (await response.json()) as { admission: Admission | null };
	return { admission };
}

/**
 * Answer a request for the socket's path. An upgrade is put to the app's port
 * through `ask`: a caller the port admits is handed to its scope's object with
 * its grant, and one it refuses is answered with a socket closed with
 * `CLOSE_REFUSED`, which a page can read where it cannot read a status.
 */
export async function handSocket(
	request: Request,
	{
		namespace,
		portPath,
		ask,
	}: {
		namespace: ScopeNamespace;
		portPath: string;
		ask: (asked: Request) => Promise<Response>;
	},
): Promise<Response> {
	if (!isUpgrade(request)) return new Response('Expected a WebSocket upgrade', { status: 426 });
	const answer = await readPortAnswer(await ask(portRequest(request, portPath)), portPath);
	if ('response' in answer) return answer.response;
	if (answer.admission === null) return refuseSocket();
	const { scope, grant } = answer.admission;
	return connectSocket(namespace.getByName(scope), request, grant);
}
