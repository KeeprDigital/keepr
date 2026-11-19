import type { H3Event } from 'h3';
import type { Delivery } from '@keepr/realtime/object';
import type {
	AfterAnswer,
	EventMessage,
	ScreenChannelDelivery,
} from '~~/server/modules/screen-output-publication';
import type { MessagePayload, MessageType } from '../types/messages';
import Ably from 'ably';
import { publishToScreenOutputs } from '~~/server/modules/screen-output-publication';
import {
	eventRealtimeChannel,
	eventRealtimeScope,
	screenRealtimeChannel,
} from '~~/shared/utils/realtimeChannels';
import {
	createMessage,
	MAX_REALTIME_MESSAGE_BYTES,
	realtimeMessageBytes,
	screenCommandMessageTypes,
} from '../types/messages';
import { ServiceConfigurationError } from '@keepr/nuxt-layer/server/utils/errors';
import { publishFailureFields, RealtimePublishError } from './realtimePublishFailure';

/**
 * What the server publishes, and to where: every message goes by RPC to its
 * Event's object, on the Worker's own binding (ADR-0137, ADR-0140). Nothing
 * here publishes to Ably.
 *
 * The file keeps its name, and `getAblyClient`, for `GET /api/realtime/token`,
 * which still signs Ably token requests for the pages. Both go when the pages
 * move onto the object (#1317).
 */

/** The environment name behind `runtimeConfig.ablyApiKey`, as the operator sets it. */
const ABLY_API_KEY_SETTING = 'NUXT_ABLY_API_KEY';

let ablyClient: Ably.Rest | null = null;

/**
 * Ably's client, for the token route alone, or the name of the setting that
 * would have produced one.
 *
 * A `ServiceConfigurationError` rather than a bare throw because of where this
 * failure is read: an unset key is an unfinished deployment, and the only person
 * who can finish it is the one holding the response. A plain `Error` matches no
 * branch of `mapPublicNitroError`, so the 5xx sanitizer rewrote it to 'Internal
 * Server Error' and the operator got a stack-free 500 for a one-line environment
 * change — the exact #233 symptom, one setting over (#267). The classification is
 * what makes the message public: it names a setting and never a value.
 */
export function getAblyClient(): Ably.Rest {
	if (!ablyClient) {
		const config = useRuntimeConfig();

		const serverApiKey = config.ablyApiKey;

		if (!serverApiKey) {
			throw new ServiceConfigurationError(ABLY_API_KEY_SETTING, 'is not configured');
		}

		ablyClient = new Ably.Rest(serverApiKey);
	}

	return ablyClient;
}

/**
 * The id a page names itself by. On the object's transport a page makes its
 * own: 32 hex characters. On Ably it is the connection's id, a short
 * base64url-style token (a connection key adds `!`). Generous against both,
 * tight against the header being an arbitrary channel: the value rides inside
 * every message published with it, so an unbounded one inflates each of them.
 */
const ORIGIN_CONNECTION_ID_SHAPE = /^[\w!-]{1,64}$/;

/**
 * The origin connection id the client self-reports so the echo filter can drop
 * its own updates. Client-supplied and unverifiable, so the one thing this does
 * is refuse to relay a value no page could have named itself by — malformed or
 * oversized reads as no origin at all, which only costs that client its echo
 * suppression.
 */
export function getOriginConnectionId(event: H3Event): string | undefined {
	const raw = getHeader(event, 'x-realtime-connection-id');
	if (!raw || !ORIGIN_CONNECTION_ID_SHAPE.test(raw)) return undefined;
	return raw;
}

/**
 * Say so when a message is over the 64 KiB a message stays within (ADR-0004).
 *
 * It reports rather than refuses. The write this announces has already
 * committed, and the object delivers a larger message all the same: the bound
 * is a design rule, which a message type that outgrows it is redesigned to keep
 * (#95), and this line is how anyone finds out that one has.
 */
function reportOversizedMessage<T extends MessageType>(
	eventId: number,
	messageType: T,
	payload?: MessagePayload<T>,
	originConnectionId?: string,
): void {
	const bytes = realtimeMessageBytes(eventId, messageType, payload, originConnectionId);
	if (bytes <= MAX_REALTIME_MESSAGE_BYTES) return;

	console.error(
		JSON.stringify({
			message: 'realtime_publish_oversized',
			eventId,
			messageType,
			bytes,
			limit: MAX_REALTIME_MESSAGE_BYTES,
		}),
	);
}

/**
 * The Worker's bindings. Nitro sets them before a request or a scheduled run
 * reaches any of this, as `server/db` reads `DB`.
 */
function workerBindings(): object {
	return (globalThis as { __env__?: object }).__env__ ?? {};
}

/**
 * One message for one channel: the message whole, as `createMessage` builds it,
 * under its type. A page's transport hands a handler the delivery's data as
 * the message, and its echo filter reads the origin connection id inside it.
 *
 * As JSON, which is what a page is sent: the RPC would otherwise refuse a whole
 * call over one value that JSON only leaves out.
 */
function delivery<T extends MessageType>(
	channel: string,
	eventId: number,
	messageType: T,
	payload?: MessagePayload<T>,
	originConnectionId?: string,
): Delivery {
	return {
		channel,
		name: messageType,
		data: JSON.parse(
			JSON.stringify(createMessage(eventId, messageType, payload, originConnectionId)),
		),
	};
}

/**
 * Publish to an Event's object, through the realtime layer's
 * `useRealtimeScope`: one call, whose deliveries the object sends in order. It
 * rejects when the Worker has no binding for the object, or the object could
 * not be reached or threw.
 */
async function publishToEvent(eventId: number, deliveries: readonly Delivery[]): Promise<void> {
	await useRealtimeScope(workerBindings(), eventRealtimeScope(eventId)).publish(deliveries);
}

/**
 * Publish each Screen's messages to its own channel, in one call for every
 * Screen, whatever their number. No Screen is refused alone: the call answers
 * or fails as one.
 */
async function publishToScreenChannels(
	eventId: number,
	deliveries: readonly ScreenChannelDelivery[],
): Promise<void> {
	await publishToEvent(
		eventId,
		deliveries.flatMap(({ screenId, messages }) =>
			messages.map(({ type, payload, originConnectionId }) =>
				delivery(
					screenRealtimeChannel(eventId, screenId),
					eventId,
					type,
					payload,
					originConnectionId,
				),
			),
		),
	);
}

/**
 * The request this publish is made in, where the Worker can finish work after
 * answering it (`nitro.experimental.asyncContext`, and the Worker's
 * `waitUntil`). None in a scheduled handler, a request Nitro makes of itself
 * with no platform context, or a unit test: there the publish waits.
 */
function requestAfterAnswer(): AfterAnswer | undefined {
	try {
		const request = useEvent();
		const executionContext = request.context.cloudflare?.context;
		return (
			executionContext && {
				request,
				waitUntil: (work) => executionContext.waitUntil(work),
			}
		);
	} catch {
		return undefined;
	}
}

/**
 * Tell the Screens of a message just published on their Event's channel. Every
 * Event publish in this file ends here, so no publish site can leave its
 * Screens untold; it never throws, whatever became of the Event publish.
 */
async function tellScreenOutputs<T extends MessageType>(
	eventId: number,
	messageType: T,
	payload: MessagePayload<T> | undefined,
	originConnectionId?: string,
): Promise<void> {
	await publishToScreenOutputs(
		eventId,
		{ type: messageType, payload } as EventMessage,
		originConnectionId,
		publishToScreenChannels,
		requestAfterAnswer(),
	);
}

// Overload for messages with payload
export async function publishMessage<T extends MessageType>(
	eventId: number,
	messageType: T,
	payload: MessagePayload<T> extends undefined ? never : MessagePayload<T>,
	originConnectionId?: string,
): Promise<void>;

// Overload for messages without payload (undefined)
export async function publishMessage<T extends MessageType>(
	eventId: number,
	messageType: T,
	payload?: MessagePayload<T> extends undefined ? undefined : never,
	originConnectionId?: string,
): Promise<void>;

// Implementation
export async function publishMessage<T extends MessageType>(
	eventId: number,
	messageType: T,
	payload?: MessagePayload<T>,
	originConnectionId?: string,
): Promise<void> {
	try {
		reportOversizedMessage(eventId, messageType, payload, originConnectionId);
		await publishToEvent(eventId, [
			delivery(eventRealtimeChannel(eventId), eventId, messageType, payload, originConnectionId),
		]);
	} catch (error) {
		// Realtime delivery is best-effort for this API, so this line is the only
		// witness that the publish was attempted and failed. It carries the bounded
		// routing identifiers and the failure's own account of itself, and nothing
		// else.
		console.error(
			JSON.stringify({
				message: 'realtime_publish_failed',
				eventId,
				messageType,
				...publishFailureFields(error),
			}),
		);
	}
	await tellScreenOutputs(eventId, messageType, payload, originConnectionId);
}

/**
 * Publish an Event message while preserving delivery failures for callers that
 * need to distinguish committed persistence from realtime notification state.
 * The default publishMessage API intentionally retains its legacy log-and-
 * swallow behavior for unrelated callers.
 *
 * Only the Event channel's failure is preserved, as it was thrown. The Screens
 * are told after it either way, before this answers or after the request does,
 * and a Screen channel's failure is never this function's.
 */
export async function publishMessageStrict<T extends MessageType>(
	eventId: number,
	messageType: T,
	payload: MessagePayload<T>,
	originConnectionId?: string,
): Promise<void> {
	try {
		reportOversizedMessage(eventId, messageType, payload, originConnectionId);
		await publishToEvent(eventId, [
			delivery(eventRealtimeChannel(eventId), eventId, messageType, payload, originConnectionId),
		]);
	} finally {
		await tellScreenOutputs(eventId, messageType, payload, originConnectionId);
	}
}

/**
 * Send a Screen a command, and say whose failure it was when it does not arrive.
 *
 * The one publish in this file that neither swallows nor propagates raw. Its
 * caller has no local effect to fall back on — the command *is* the request — so
 * a failure has to reach the caller, and #242 recorded that contract
 * deliberately. What it must not do is reach the caller as whatever was thrown:
 * h3 adopts `statusCode` from anything thrown, so a failure carrying a 404 would
 * become the route's 404 and read as the Screen not existing (#264).
 * `RealtimePublishError` is the classification that separates the two, and the
 * log line beside it is the only place the failure's own account is written down.
 *
 * A Worker with no binding for the object fails the same way: nothing an
 * operator sets leaves one out, and the log line names the binding.
 */
export async function publishScreenCommand(
	eventId: number,
	screenId: number,
	command: ScreenCommand,
): Promise<void> {
	const messageType = screenCommandMessageTypes[command];

	try {
		await publishToEvent(eventId, [
			delivery(screenRealtimeChannel(eventId, screenId), eventId, messageType, { screenId }),
		]);
	} catch (error) {
		console.error(
			JSON.stringify({
				message: 'realtime_publish_failed',
				eventId,
				screenId,
				messageType,
				...publishFailureFields(error),
			}),
		);
		throw new RealtimePublishError(error);
	}
}
