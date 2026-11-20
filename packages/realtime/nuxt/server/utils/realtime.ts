import type { EventHandler, H3Event } from 'h3';
import type { Delivery, DisconnectOptions, PublishAnswer } from '../../../src/object/index.ts';
import type { Admission } from '../worker/handOff.ts';
import { createError, defineEventHandler, getRequestHeader, isEvent, setResponseHeader } from 'h3';
import { useRuntimeConfig } from 'nitropack/runtime';
import { HAND_OFF_HEADER, PORT_ANSWER_HEADER } from '../worker/headers.ts';
import { isMarkedHandOff } from '../worker/mark.ts';

export type { Admission };

/**
 * The app's port (ADR-0137): given the request a socket came with, who the
 * caller is, the scope it joins and the channels it may hear and enter there,
 * or `null` to refuse it. The event carries the caller's headers and the
 * socket's query, so the app reads a cookie or a ticket as it does anywhere.
 */
export type RealtimePort = (
	event: H3Event,
) => Admission | null | undefined | Promise<Admission | null | undefined>;

/** One scope's object, as the server uses it: over RPC, on the app's own binding. */
export interface RealtimeScope {
	/** Publish each delivery in order. Answers each one's sequence, and the sockets it reached. */
	publish(deliveries: readonly Delivery[]): Promise<PublishAnswer[]>;
	/**
	 * Close every socket a grant tagged `tag`, and for a minute let none in.
	 * One whose grant also carries `except` is spared. Answers how many closed.
	 */
	disconnect(tag: string, options?: DisconnectOptions): Promise<number>;
	/**
	 * Close every socket of the scope, whatever its grant, and for a minute let
	 * none in: for a scope the app has ended. Answers how many closed.
	 */
	disconnectAll(): Promise<number>;
}

interface ScopeNamespace {
	getByName(scope: string): RealtimeScope;
}

/**
 * What Nitro's Cloudflare preset puts on an event's context, as far as this
 * reads it. Nitro leaves it untyped and an app may type it more narrowly, so
 * it is read here as what it is known to hold.
 */
function cloudflareOf(event: H3Event): { request?: unknown; env?: object } | undefined {
	return event.context.cloudflare as { request?: unknown; env?: object } | undefined;
}

function sameSecret(given: string, secret: string): boolean {
	if (given.length !== secret.length) return false;
	let difference = 0;
	for (let index = 0; index < secret.length; index++)
		difference |= given.charCodeAt(index) ^ secret.charCodeAt(index);
	return difference === 0;
}

/**
 * Whether this request is the hand-off's own, which nothing a caller sends can
 * make it. The built Worker's entry marks the request object it made. Under
 * `nuxt dev` the request comes over the loopback from the Worker beside the dev
 * server, carrying a secret made for this run of it.
 */
function isHandOff(event: H3Event): boolean {
	if (import.meta.dev) {
		const { handOffSecret } = useRuntimeConfig(event).realtime;
		const given = getRequestHeader(event, HAND_OFF_HEADER);
		return handOffSecret !== '' && given !== undefined && sameSecret(given, handOffSecret);
	}
	return isMarkedHandOff(cloudflareOf(event)?.request);
}

/**
 * The route that answers the app's port. The layer registers no route, so the
 * app exports this from a file of its own, at the path its `realtime.portPath`
 * names:
 *
 * ```ts
 * // server/routes/realtime/port.ts
 * export default defineRealtimePort(async (event) => {
 * 	const user = await whoIsThis(event); // the app's own rule
 * 	if (!user) return null;
 * 	return { scope: `room:${room}`, grant: { identity: user.id, hear: [`room:${room}:*`] } };
 * });
 * ```
 *
 * Only the hand-off reaches it: any other request is answered 404, so the
 * route is no way to ask what a caller may hear, and no way in.
 */
export function defineRealtimePort(port: RealtimePort): EventHandler {
	return defineEventHandler(async (event) => {
		if (!isHandOff(event)) throw createError({ statusCode: 404, statusMessage: 'Not Found' });
		const admission = (await port(event)) ?? null;
		setResponseHeader(event, PORT_ANSWER_HEADER, '1');
		return { admission };
	});
}

/**
 * One scope's object on the app's own binding (`realtime.binding`), to publish
 * to by RPC, or to disconnect a withdrawn credential's sockets from. Given a
 * request's event, or the Worker's bindings where there is no request, as in a
 * scheduled handler.
 *
 * ```ts
 * await useRealtimeScope(event, `room:${room}`).publish([{ channel, name, data }]);
 * ```
 */
export function useRealtimeScope(source: H3Event | object, scope: string): RealtimeScope {
	const fromEvent = isEvent(source);
	const { binding } = (fromEvent ? useRuntimeConfig(source) : useRuntimeConfig()).realtime;
	const bindings = (fromEvent ? cloudflareOf(source)?.env : source) as
		| Record<string, ScopeNamespace | undefined>
		| undefined;
	const namespace = bindings?.[binding];
	if (!namespace)
		throw new Error(
			`The Worker has no ${binding} binding: bind the realtime object in the app's Wrangler configuration, and in the one nuxt dev reads.`,
		);
	return namespace.getByName(scope);
}
