import { graphicsCatalogueClient } from '~~/server/modules/graphics-asset-library/runtime';
import { createD1RealtimeTickets } from '~~/server/modules/realtime-ticket';
import { screenOutputAssetCapabilityDigest } from '~~/server/modules/screen-output-assets/capability';
import { eventIdParamSchema } from '~~/server/schemas/api/eventId';
import { bearerScreenOutputCapability } from '~~/server/utils/screenOutputCapabilityAuthorization';

/**
 * `POST /api/realtime/ticket?eventId=<id>`: a Screen Output presents its Screen
 * Output Asset Capability, as a bearer, and is given a Realtime Ticket for one
 * socket of that Event (ADR-0137, ADR-0142). A browser cannot put
 * `Authorization` on a WebSocket, so the capability is presented here and the
 * socket carries the ticket.
 *
 * Outside the Session boundary because a Screen Output has no Session, and the
 * capability is the only credential: a Session the request happens to carry is
 * never read, so an output is given its ticket while Keepr Accounts cannot be
 * asked, and a signed-in User with no capability is refused like anyone else.
 *
 * **Every refusal is one 401.** A missing capability, one that is no Screen's,
 * one whose Screen is in another Event, and an Event id that is not one are
 * answered alike, so nothing says which half of the request was wrong. A page
 * reads it as the refusal; any other failure it retries.
 */
export default defineEventHandler(async (event) => {
	const eventId = eventIdParamSchema.safeParse(getQuery(event).eventId);
	const capability = bearerScreenOutputCapability(getRequestHeader(event, 'authorization'));

	const ticket =
		eventId.success && capability
			? await createD1RealtimeTickets(graphicsCatalogueClient()).give({
					capabilityDigest: await screenOutputAssetCapabilityDigest(capability),
					eventId: eventId.data,
				})
			: null;
	if (!ticket) {
		throw createError({
			statusCode: 401,
			statusMessage: 'Unauthorized',
			message: 'A Screen Output Asset Capability of this Event is required',
		});
	}

	setResponseHeader(event, 'cache-control', 'private, no-store');
	return { ticket: ticket.ticket, expiresAt: ticket.expiresAt.toISOString() };
});
