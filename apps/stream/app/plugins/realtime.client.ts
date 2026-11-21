import type { RealtimeTransport } from '~/types/realtime';
import { RefusedError } from '@keepr/realtime/client';
import { createSocketRealtimeTransport } from '~/modules/realtime-transport/socketTransport';
import { REALTIME_SOCKET_PATH } from '~~/shared/utils/realtimeChannels';
import {
	screenOutputAssetCapabilityFromHash,
	screenOutputCapabilityHeaders,
} from '~~/shared/utils/screenOutput';

/** Where a Screen Output is given a Realtime Ticket, for one socket of its Event (ADR-0142). */
const REALTIME_TICKET_PATH = '/api/realtime/ticket';

/** The statuses by which the ticket's route says this output may not, as distinct from could not be answered. */
const REFUSED_STATUSES = [401, 403];

/** How many refusals in a row are asked about each time the transport retries. */
const REFUSALS_ASKED_EACH_TIME = 4;
/** The wait after the first refusal past those, doubled after each later one. */
const REFUSED_ASK_FIRST_WAIT_MS = 60_000;
/** The longest a refused capability waits before its ticket is asked for again. */
const REFUSED_ASK_CEILING_MS = 10 * 60_000;

/** How long a capability refused `refusals` times in a row waits before it is asked about again. */
function refusedAskWaitMs(refusals: number): number {
	if (refusals <= REFUSALS_ASKED_EACH_TIME) return 0;
	return Math.min(
		REFUSED_ASK_FIRST_WAIT_MS * 2 ** (refusals - REFUSALS_ASKED_EACH_TIME - 1),
		REFUSED_ASK_CEILING_MS,
	);
}

/** The HTTP status a failed `$fetch` carries, when the server answered at all. */
function answeredStatus(error: unknown): number | undefined {
	const { statusCode, response } = error as {
		statusCode?: number;
		response?: { status?: number };
	};
	return statusCode ?? response?.status;
}

/**
 * The app's realtime: the `RealtimeTransport` port, answered over a Durable
 * Object per Event (ADR-0137, ADR-0140) by
 * `app/modules/realtime-transport/socketTransport.ts`. Holding a Realtime
 * Subscription, reconnecting and catching up are that transport's. This says
 * only where a page's socket is, and when the page is gone.
 *
 * **Which address a page asks for is decided by what it holds**, read afresh
 * for each socket:
 *
 * - **A page holding a Screen Output Asset Capability** in its URL fragment is
 *   a Screen Output, or a Program Monitor. A browser cannot put `Authorization`
 *   on a WebSocket, so it presents the capability for a Realtime Ticket and its
 *   socket carries that. A Realtime Ticket admits one socket, so each connect
 *   fetches another.
 * - **Any other page** is its Session's: the socket's URL alone, since the
 *   browser sends the Session's cookie with the upgrade. An operator's page is
 *   one, and so is an editor preview, which holds no capability.
 *
 * A page with a capability is never let in as its Session instead: a Screen
 * Output opened in a signed-in browser hears its own Screen's channel, as it
 * does anywhere.
 */
export default defineNuxtPlugin({
	name: 'realtime',
	setup() {
		/** One Event's socket, on the host that served the page: `wss`, or `ws` on plain HTTP. */
		function socketAddress(eventId: number): string {
			const { protocol, host } = window.location;
			return `${protocol === 'https:' ? 'wss:' : 'ws:'}//${host}${REALTIME_SOCKET_PATH}?eventId=${eventId}`;
		}

		/**
		 * What each capability's ticket route last refused, by Event. An output
		 * that can never be let in, its Screen deleted or its capability
		 * regenerated, is refused again without a request until its wait is out
		 * (ADR-0162): the transport's every-30-s retries cost the server nothing.
		 */
		const refused = new Map<
			string,
			{ refusals: number; askAfter: number; refusal: RefusedError }
		>();

		/**
		 * A Realtime Ticket for one socket of `eventId`, for the capability this page holds.
		 *
		 * Refused (401, 403) rejects with `RefusedError`, which the transport
		 * reports as the refusal: `tokenError`, with retries at the slow rhythm.
		 * Anything else rejects plainly, as a network that did not answer does: a
		 * failed attempt, retried, and never a reason to tell an operator the output
		 * may not hear.
		 */
		async function ticketFor(eventId: number, capability: string): Promise<string> {
			const key = `${eventId}\n${capability}`;
			const held = refused.get(key);
			if (held && Date.now() < held.askAfter) throw held.refusal;
			let answer: { ticket?: unknown };
			try {
				answer = await $fetch<{ ticket?: unknown }>(REALTIME_TICKET_PATH, {
					method: 'POST',
					query: { eventId },
					headers: screenOutputCapabilityHeaders(capability),
				});
			} catch (error) {
				const status = answeredStatus(error);
				if (status !== undefined && REFUSED_STATUSES.includes(status)) {
					const refusal = new RefusedError(
						`No Realtime Ticket for this Screen Output (${status})`,
						{
							cause: error,
						},
					);
					const refusals = (held?.refusals ?? 0) + 1;
					refused.set(key, {
						refusals,
						askAfter: Date.now() + refusedAskWaitMs(refusals),
						refusal,
					});
					throw refusal;
				}
				throw error;
			}
			refused.delete(key);
			// An answer with no ticket is the server's defect, not its refusal.
			if (typeof answer?.ticket !== 'string' || answer.ticket === '')
				throw new Error('The Realtime Ticket route answered with no ticket');
			return answer.ticket;
		}

		async function address(eventId: number): Promise<string> {
			const capability = screenOutputAssetCapabilityFromHash(window.location.hash);
			if (!capability) return socketAddress(eventId);
			const ticket = await ticketFor(eventId, capability);
			return `${socketAddress(eventId)}&ticket=${encodeURIComponent(ticket)}`;
		}

		// A page that changes what it holds is admitted afresh on it (ADR-0162).
		const transport = createSocketRealtimeTransport({
			address,
			credential: () => screenOutputAssetCapabilityFromHash(window.location.hash) ?? null,
		});

		// `pagehide`, not `beforeunload`: the latter also fires when the operator
		// then picks "Stay" on the unsaved-changes prompt, and the page that stays
		// open would have no realtime until a full reload (#1026).
		window.addEventListener('pagehide', () => transport.dispose());
		// A page restored from the back/forward cache was disposed above, and its
		// handlers are gone: load it afresh rather than show it deaf.
		window.addEventListener('pageshow', (event) => {
			if (event.persisted) window.location.reload();
		});

		// The port alone: ending the transport is this plugin's, not a consumer's.
		const realtime: RealtimeTransport = transport;
		return { provide: { realtime } };
	},
});
