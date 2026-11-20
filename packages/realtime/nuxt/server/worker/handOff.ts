import { connectSocket, refuseSocket, TICKET_HEADER } from '../../../src/object/handOff.ts';
import type { RealtimeObjectStub } from '../../../src/object/handOff.ts';
import type { Grant } from '../../../src/object/grant.ts';
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

/** The statuses by which an app refuses a caller before its port is reached. */
const REFUSING_STATUSES: ReadonlySet<number> = new Set([401, 403]);

const isUpgrade = (request: Request): boolean =>
	request.headers.get('upgrade')?.toLowerCase() === 'websocket';

/**
 * The request the port is asked with: a plain `GET` of the port's path, with
 * the socket's query, the caller's own headers and its Cloudflare properties,
 * so the app reads a cookie, an `Origin`, a ticket or the caller's country as
 * it reads them anywhere. Nothing of the upgrade goes with it, and neither does
 * a header the hand-off itself reads: a caller that sends one gains nothing.
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
	const { cf } = request as { cf?: unknown };
	return new Request(url, { headers, ...(cf !== undefined && { cf }) } as RequestInit);
}

const noPort = (portPath: string, why: string): PortAnswer => ({
	response: new Response(
		`No port answered at ${portPath} (${why}): the app's route there is defineRealtimePort's.`,
		{ status: 500 },
	),
});

/**
 * Read the port's answer off the app's response to `portRequest`. An app that
 * answers 401 or 403 before its port is reached, as a middleware does, refuses
 * the caller as the port's `null` does.
 */
export async function readPortAnswer(response: Response, portPath: string): Promise<PortAnswer> {
	if (response.headers.get(PORT_ANSWER_HEADER) === null) {
		if (REFUSING_STATUSES.has(response.status)) return { admission: null };
		// A failure, or no route: the app's to explain.
		if (response.status >= 400) return { response };
		return noPort(portPath, 'its answer carried no port header');
	}
	try {
		const { admission } = (await response.json()) as { admission: Admission | null };
		return { admission: admission ?? null };
	} catch {
		return noPort(portPath, 'its answer was not one');
	}
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
		binding,
		portPath,
		ask,
	}: {
		namespace: ScopeNamespace | undefined;
		/** The binding's name, for the error that says it is missing. */
		binding: string;
		portPath: string;
		ask: (asked: Request) => Promise<Response>;
	},
): Promise<Response> {
	if (!isUpgrade(request)) return new Response('Expected a WebSocket upgrade', { status: 426 });
	if (!namespace)
		return new Response(
			`The Worker has no ${binding} binding: bind the realtime object in the app's Wrangler configuration.`,
			{ status: 500 },
		);
	const answer = await readPortAnswer(await ask(portRequest(request, portPath)), portPath);
	if ('response' in answer) return answer.response;
	if (answer.admission === null) return refuseSocket();
	const { scope, grant } = answer.admission;
	return connectSocket(namespace.getByName(scope), request, grant);
}
