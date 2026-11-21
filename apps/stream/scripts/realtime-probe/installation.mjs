/**
 * What the realtime probe asks of an Installation over HTTP (#1338), each as
 * the page it stands for asks it. Nothing in the app is opened for the probe,
 * and it holds no credential of its own:
 *
 * - **As a signed-in page**: the Session a person signed in to at Keepr
 *   Accounts, or locally the Local Developer User's, by the Accounts
 *   Stand-in's cookie (ADR-0141, ADR-0158).
 *   It reads the Event's Screens, is handed each Screen Output's URL as the
 *   Output Hand-out is, and makes the write.
 * - **As a Screen Output**: the URL it was handed, and nothing else. It reads
 *   its Screen Output Asset Capability from the URL's fragment, finds its
 *   Screen by the slug in the path, and presents the capability for a Realtime
 *   Ticket for each socket (`app/plugins/realtime.client.ts`, ADR-0142). It
 *   sends no cookie.
 */

import { readFile } from 'node:fs/promises';
import { LOCAL_DEVELOPER_COOKIE } from '@keepr/accounts-stand-in/cookie';
import { RefusedError } from '@keepr/realtime/client';
import { parseJsonc } from '@keepr/tooling/scripts/jsonc.mjs';
import { screenCommandMessageTypes } from '../../shared/types/messages.ts';
import {
	eventRealtimeChannel,
	REALTIME_SOCKET_PATH,
	screenRealtimeChannel,
} from '../../shared/utils/realtimeChannels.ts';
import {
	screenOutputAssetCapabilityFromHash,
	screenOutputCapabilityHeaders,
	screenOutputPath,
} from '../../shared/utils/screenOutput.ts';
import {
	ACCOUNTS_ORIGIN_ENV,
	isLoopbackOrigin,
	keeprAccountsOriginOf,
	openOperatorSession,
	OPERATOR_EMAIL_ENV,
	OPERATOR_PASSWORD_ENV,
} from '../graphics-acceptance/operator.mjs';

/** What the probe will not do as asked, said to the person who asked. */
export class ProbeRefusal extends Error {
	name = 'ProbeRefusal';
}

/**
 * The write the probe publishes through: the Screen command that tells a
 * Screen's outputs to hide their debug panel.
 *
 * A Screen command stores nothing, so there is nothing to put back: its
 * message is the whole of what it does (`publishScreenCommand`). An output
 * that hears this one leaves its debug panel hidden, as it is unless an
 * operator is debugging that output just then, and an output is where it was
 * however often it hears it. It is published on the Screen's own channel
 * before the write answers, which is the path a Take's message takes to an
 * output.
 */
export const PROBE_COMMAND = { command: 'debug', shown: false };

/**
 * Whether a message is one the probe's write announces. Another person's
 * identical command is told apart by its time (`measure.mjs`).
 *
 * @param {{ name: string, data: any }} frame
 */
export function isProbeMessage(frame) {
	return frame.name === screenCommandMessageTypes.debug && frame.data?.shown === false;
}

/** The Environments' origins, from the app's deploy descriptor. */
export async function loadEnvironmentOrigins() {
	const descriptor = parseJsonc(
		await readFile(new URL('../../deploy.jsonc', import.meta.url), 'utf8'),
	);
	return Object.fromEntries(
		Object.entries(descriptor.environments).map(([name, { url }]) => [name, new URL(url).origin]),
	);
}

/**
 * Where a run is pointed, and whether it may go there.
 *
 * A server on this machine and the Staging Installation are probed as asked.
 * Anywhere else, Production above all, is probed only when the run names the
 * person who said to: the probe writes, and to an Installation with a show on
 * it that is a person's decision (ADR-0129, #1318).
 *
 * @param {string} origin
 * @param {Record<string, string>} environments Each Environment's origin.
 * @param {string | undefined} saidBy
 */
export function probeTarget(origin, environments, saidBy) {
	let url;
	try {
		url = new URL(origin);
	} catch {
		throw new ProbeRefusal(`Not an origin: ${JSON.stringify(origin)}`);
	}
	const where = isLoopbackOrigin(url.origin)
		? 'local'
		: (Object.entries(environments).find(([, named]) => named === url.origin)?.[0] ?? 'elsewhere');
	if (where !== 'local' && where !== 'staging' && !saidBy?.trim()) {
		throw new ProbeRefusal(
			`${url.origin} is ${where === 'elsewhere' ? 'neither local nor an Environment of Stream Keepr' : where}. ` +
				`The probe writes there only on a person's say: name them with --said-by.`,
		);
	}
	return { origin: url.origin, where, ...(saidBy?.trim() && { saidBy: saidBy.trim() }) };
}

/**
 * The Session the run works in, as the cookie its requests carry: locally the
 * Accounts Stand-in's, which names the Local Developer User. A request with
 * none is signed out without anyone being asked (ADR-0158).
 *
 * Anywhere else the person running the probe signs in, as they do in a
 * browser: their email and password go to the Installation's Keepr Accounts
 * and nowhere else, by the request its sign-in page makes
 * (`graphics-acceptance/operator.mjs`), and the Session it answers is held in
 * memory for the run. Nothing of it is printed or written.
 *
 * @param {string} origin
 * @param {{ env?: Record<string, string | undefined>, fetchRequest?: typeof fetch }} [options]
 */
export async function openSession(origin, { env = process.env, fetchRequest = fetch } = {}) {
	if (isLoopbackOrigin(origin)) return LOCAL_DEVELOPER_COOKIE;
	let accounts;
	try {
		accounts = keeprAccountsOriginOf(origin, env);
	} catch {
		throw new ProbeRefusal(
			`No Keepr Accounts is known for ${origin}: name it with ${ACCOUNTS_ORIGIN_ENV}.`,
		);
	}
	if (!env[OPERATOR_EMAIL_ENV]?.trim() || !env[OPERATOR_PASSWORD_ENV]?.trim()) {
		throw new ProbeRefusal(
			`The probe signs in to ${accounts} as you: set ${OPERATOR_EMAIL_ENV} and ` +
				`${OPERATOR_PASSWORD_ENV} to your own User's, who has App access to Stream Keepr there.`,
		);
	}
	try {
		return (await openOperatorSession(origin, { deployed: true, env, fetchRequest })).join('; ');
	} catch (failure) {
		const { actual, reason } = /** @type {any} */ (failure).detail ?? {};
		throw new ProbeRefusal(
			`Keepr Accounts did not sign you in (${actual ?? reason ?? /** @type {Error} */ (failure).message}).`,
			{ cause: failure },
		);
	}
}

/** The address of an Event's socket on `origin`: `wss`, or `ws` on plain HTTP. */
function socketAddress(origin, eventId) {
	return `${origin.replace(/^http/, 'ws')}${REALTIME_SOCKET_PATH}?eventId=${eventId}`;
}

async function answered(response, what) {
	if (!response.ok) throw new Error(`${what} answered ${response.status}`);
	return await response.json();
}

/**
 * The Installation as a signed-in page of it asks.
 *
 * @param {{ origin: string, cookie: string, fetchRequest?: typeof fetch }} options
 */
export function createSignedInPage({ origin, cookie, fetchRequest = fetch }) {
	/** What the page's browser sends: its Session, and where the page is from. */
	const headers = { ...(cookie && { cookie }), origin };

	return {
		/** What its socket carries besides its address. */
		socketHeaders: headers,
		socketAddress: (eventId) => socketAddress(origin, eventId),
		/** The channels an operator's page may hold: its Event's, and each Screen's it shows. */
		channels: (eventId, screenIds) => [
			eventRealtimeChannel(eventId),
			...screenIds.map((screenId) => screenRealtimeChannel(eventId, screenId)),
		],

		/** @returns {Promise<{ id: number, slug: string, name: string }[]>} */
		async screens(eventId) {
			const { screens } = await answered(
				await fetchRequest(`${origin}/api/events/${eventId}/screens`, { headers }),
				`The Screens of Event ${eventId}`,
			);
			return screens;
		},

		/**
		 * A Screen Output's URL, as the Output Hand-out builds one: the capability
		 * asked for at the hand-out, and carried in the fragment
		 * (`app/composables/screen/useScreenOutputAccessUrl.ts`).
		 */
		async outputUrl(eventId, screen) {
			const { assetCapability } = await answered(
				await fetchRequest(
					`${origin}/api/events/${eventId}/screens/${screen.id}/asset-capability`,
					{ headers },
				),
				`The Screen Output Asset Capability of Screen ${screen.id}`,
			);
			return `${origin}${screenOutputPath({ eventId, screenSlug: screen.slug, assetCapability })}`;
		},

		/**
		 * Make the probe's write to one Screen. Answers whether it was accepted,
		 * and never throws: a write that fails is something the run records.
		 */
		async publish(eventId, screenId) {
			try {
				const response = await fetchRequest(
					`${origin}/api/events/${eventId}/screens/${screenId}/command`,
					{
						method: 'POST',
						headers: { ...headers, 'content-type': 'application/json' },
						body: JSON.stringify(PROBE_COMMAND),
						signal: AbortSignal.timeout(30_000),
					},
				);
				await response.arrayBuffer();
				return response.ok ? { ok: true } : { ok: false, why: `HTTP ${response.status}` };
			} catch (error) {
				return { ok: false, why: /** @type {Error} */ (error).message };
			}
		},
	};
}

/**
 * A Screen Output, from the URL it was handed and nothing else: which Screen
 * it is, the channel it holds, and its socket's address.
 *
 * @param {string} outputUrl
 * @param {{ fetchRequest?: typeof fetch }} [options]
 */
export async function openScreenOutput(outputUrl, { fetchRequest = fetch } = {}) {
	const url = new URL(outputUrl);
	const path = /^\/event\/(\d+)\/screen\/([^/]+)$/.exec(url.pathname);
	const capability = screenOutputAssetCapabilityFromHash(url.hash);
	if (!path || !capability)
		throw new Error('Not a Screen Output URL that carries a Screen Output Asset Capability');
	const eventId = Number(path[1]);
	const presented = screenOutputCapabilityHeaders(capability);

	const screen = await answered(
		await fetchRequest(
			`${url.origin}/api/screen-output/events/${eventId}/screens/slug/${path[2]}`,
			{ headers: presented },
		),
		'The Screen of this Screen Output',
	);

	return {
		eventId,
		screenId: /** @type {number} */ (screen.id),
		channel: screenRealtimeChannel(eventId, screen.id),
		/**
		 * Its socket's address, with a Realtime Ticket fetched for this socket.
		 * Refused (401, 403) rejects with `RefusedError`, which the transport
		 * reports as the refusal; anything else is a failed attempt.
		 */
		async address() {
			const response = await fetchRequest(`${url.origin}/api/realtime/ticket?eventId=${eventId}`, {
				method: 'POST',
				headers: presented,
			});
			if (response.status === 401 || response.status === 403)
				throw new RefusedError(`No Realtime Ticket for this Screen Output (${response.status})`);
			const { ticket } = await answered(response, 'The Realtime Ticket route');
			if (typeof ticket !== 'string' || ticket === '')
				throw new Error('The Realtime Ticket route answered with no ticket');
			return `${socketAddress(url.origin, eventId)}&ticket=${encodeURIComponent(ticket)}`;
		},
	};
}
