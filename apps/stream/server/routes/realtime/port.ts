import type { H3Event } from 'h3';
import type { Admission } from '@keepr/realtime/nuxt/server/utils/realtime';
import { requestIsCrossSiteMutation } from '@keepr/nuxt-layer/server/utils/crossSiteMutation';
import { graphicsCatalogueClient } from '~~/server/modules/graphics-asset-library/runtime';
import { createD1RealtimeTickets } from '~~/server/modules/realtime-ticket';
import { eventIdParamSchema } from '~~/server/schemas/api/eventId';
import { eventService } from '~~/server/services/event';
import { requestIdentity } from '~~/server/utils/session';
import {
	eventRealtimeChannel,
	eventRealtimeScope,
	screenChannelWildcard,
	screenOutputCapabilityRealtimeTag,
	screenOutputRealtimeClientId,
	screenRealtimeChannel,
} from '~~/shared/utils/realtimeChannels';

/**
 * Stream Keepr's answer to realtime's port (ADR-0137, ADR-0142): who a
 * socket's caller is, and what it may hear and enter in the Event its query
 * names. Only the realtime layer's hand-off reaches this route; any other
 * request is answered 404 (`defineRealtimePort`).
 *
 * Two callers are let in, each by what it presents:
 *
 * - **A Screen Output** presents a Realtime Ticket (`ticket`). It hears and
 *   enters its own Screen's channel and nothing else, its Event's channel
 *   included.
 * - **A Session** presents its cookie. It hears its Event's channel and its
 *   Screens', and may enter a Screen's presence, because a signed-in Operator
 *   can open a Screen's display page.
 *
 * **A socket that presents a ticket is judged by the ticket alone.** A refused
 * ticket is never made good by a Session cookie the same browser carries: the
 * output would be handed an Operator's wider grant under an identity
 * regenerating its capability does not close.
 *
 * **Everything else is `null`**, which the layer answers with a socket closed
 * `CLOSE_REFUSED`: a page cannot read a refused upgrade's status. One answer
 * for every refusal, so nothing says why. What throws here (Keepr Accounts
 * cannot be asked, the database does not answer) is the app's own 5xx, which a
 * page reads as a failed attempt and retries: nothing that throws admits.
 */
export default defineRealtimePort(async (event) => {
	const query = getQuery(event);
	const eventId = eventIdParamSchema.safeParse(query.eventId);
	if (!eventId.success) return null;

	return query.ticket === undefined
		? await admitSession(event, eventId.data)
		: await admitScreenOutput(query.ticket, eventId.data);
});

/**
 * The method a socket's upgrade is checked as. It is a GET by the protocol's
 * letter, and the boundary's rule admits every GET: a page cannot read what
 * one answers. A socket is read by the page that opened it, so it is checked
 * as the boundary checks a request that changes state.
 */
const SOCKET_UPGRADE_CHECKED_AS = 'POST';

/** A Session's socket, or `null`. */
async function admitSession(event: H3Event, eventId: number): Promise<Admission | null> {
	// Before the Session is read, by the Session boundary's own rule
	// (`server/middleware/api-session.ts`): the Session cookie rides on a socket
	// a page of a sibling host opens, so the cookie alone says nothing of whose
	// page asked.
	const anotherSitesPage = requestIsCrossSiteMutation({
		method: SOCKET_UPGRADE_CHECKED_AS,
		secFetchSite: getRequestHeader(event, 'sec-fetch-site'),
		origin: getRequestHeader(event, 'origin'),
		requestHost: getRequestURL(event).host,
	});
	if (anotherSitesPage) return null;

	const userId = await sessionUserId(event);
	if (userId === null) return null;
	if (!(await eventService().exists(eventId))) return null;

	const identity = `user:${userId}`;
	return {
		scope: eventRealtimeScope(eventId),
		grant: {
			identity,
			hear: [eventRealtimeChannel(eventId), screenChannelWildcard(eventId)],
			enter: [screenChannelWildcard(eventId)],
			tags: [identity],
		},
	};
}

/**
 * The User a Session's socket belongs to, or `null` for a signed-out visitor
 * and for a User with no App access to Stream Keepr, whom every route refuses
 * 403 (`requestIdentity`): here both are the one refusal. Any other failure is
 * not an answer about the caller, and is thrown on.
 */
async function sessionUserId(event: H3Event): Promise<string | null> {
	try {
		return (await requestIdentity(event))?.user.id ?? null;
	} catch (refusal) {
		if ((refusal as { statusCode?: unknown }).statusCode === 403) return null;
		throw refusal;
	}
}

/** A Screen Output's socket, for the ticket it presents, or `null`. No Session is read. */
async function admitScreenOutput(ticket: unknown, eventId: number): Promise<Admission | null> {
	if (typeof ticket !== 'string') return null;
	const spent = await createD1RealtimeTickets(graphicsCatalogueClient()).spend({ ticket, eventId });
	if (!spent) return null;

	// Two tags: the name regenerating the Screen's capability disconnects, and
	// the capability that let this socket in, which that disconnect spares when
	// it is the regenerated one (`server/modules/screen-output-assets/runtime.ts`).
	// A ticket spent a moment before a regeneration carries the former
	// capability's, so the object refuses its socket though it arrives after.
	const identity = screenOutputRealtimeClientId(spent.screenId);
	const channel = screenRealtimeChannel(eventId, spent.screenId);
	return {
		scope: eventRealtimeScope(eventId),
		grant: {
			identity,
			hear: [channel],
			enter: [channel],
			tags: [identity, screenOutputCapabilityRealtimeTag(spent.screenId, spent.capabilityVersion)],
		},
	};
}
