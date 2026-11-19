import type { H3Event } from 'h3';
import type { Delivery } from '@keepr/realtime/object';
import type {
	AfterAnswer,
	EventMessage,
	ScreenChannelDelivery,
} from '~~/server/modules/screen-output-publication';
import type { MessagePayload, MessageType, ScreenCommandRequest } from '../types/messages';
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
import { publishFailureFields, RealtimePublishError } from './realtimePublishFailure';

/**
 * What the server publishes, and to where: every message goes by RPC to its
 * Event's object, on the Worker's own binding (ADR-0137, ADR-0140).
 */

/**
 * The id a page names itself by, which it makes itself: 32 hex characters
 * (`app/modules/realtime-transport/socketTransport.ts`). Generous against
 * that, tight against the header being an arbitrary channel: the value rides
 * inside every message published with it, so an unbounded one inflates each of
 * them.
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
 * not be reached or threw. Each call takes a stub of its own: one whose call
 * failed may answer nothing more.
 */
async function publishToEvent(eventId: number, deliveries: readonly Delivery[]): Promise<void> {
	await useRealtimeScope(workerBindings(), eventRealtimeScope(eventId)).publish(deliveries);
}

/**
 * Publish to an Event's object, and once more if that call fails: an object
 * being reset, as a deploy resets it, fails the call that meets it and answers
 * the next. The second is the call whole, on a stub of its own, and its
 * failure is the caller's to judge.
 *
 * The server cannot tell a call that failed from one whose answer was lost, so
 * the second can repeat what the first delivered. Each caller says why hearing
 * its message twice leaves a page where hearing it once does.
 */
async function publishToEventOnceMore(
	eventId: number,
	deliveries: readonly Delivery[],
): Promise<void> {
	const attempt = async () => await publishToEvent(eventId, deliveries);
	await attempt().catch(attempt);
}

/**
 * Publish one message on its Event's channel, and once more if that call fails
 * (`publishToEventOnceMore`).
 *
 * A repeat is safe on this channel, because a message announces and a read is
 * the authority (ADR-0137). A page holds each one as a record it adds or
 * replaces by id, as a state it keeps only if no older by sequence or revision
 * than what it holds, or as a cause to re-read: hearing one twice leaves it
 * where hearing it once did.
 *
 * The Screens' call is retried where it is made
 * (`server/modules/screen-output-publication`), and a Screen command as this
 * is (`publishScreenCommand`).
 */
async function publishOnEventChannel<T extends MessageType>(
	eventId: number,
	messageType: T,
	payload: MessagePayload<T> | undefined,
	originConnectionId: string | undefined,
): Promise<void> {
	reportOversizedMessage(eventId, messageType, payload, originConnectionId);
	await publishToEventOnceMore(eventId, [
		delivery(eventRealtimeChannel(eventId), eventId, messageType, payload, originConnectionId),
	]);
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
		await publishOnEventChannel(eventId, messageType, payload, originConnectionId);
	} catch (error) {
		// Realtime delivery is best-effort for this API, so this line is the only
		// witness that the publish was attempted, twice, and failed. It carries the
		// bounded routing identifiers and the last failure's own account of itself,
		// and nothing else.
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
 * Only the Event channel's failure is preserved, as its second attempt threw
 * it. The Screens are told after it either way, before this answers or after
 * the request does, and a Screen channel's failure is never this function's.
 */
export async function publishMessageStrict<T extends MessageType>(
	eventId: number,
	messageType: T,
	payload: MessagePayload<T>,
	originConnectionId?: string,
): Promise<void> {
	try {
		await publishOnEventChannel(eventId, messageType, payload, originConnectionId);
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
 *
 * Published once more if the call fails, as an Event message is
 * (`publishToEventOnceMore`); the failure the caller hears is the second's.
 * A command is not an announcement: an output does it each time it hears it.
 * So a command says what an output is to do, and none turns over what the
 * output last did: a repeat of one the first call did deliver reloads the
 * output again, has it say which display it is again, or leaves its debug
 * panel as `debug` names it, and the output ends where one delivery leaves
 * it. A command that turned something over, as `debug` once did its panel,
 * could not be sent twice.
 */
export async function publishScreenCommand(
	eventId: number,
	screenId: number,
	command: ScreenCommandRequest,
): Promise<void> {
	const channel = screenRealtimeChannel(eventId, screenId);
	const message =
		command.command === 'debug'
			? delivery(channel, eventId, screenCommandMessageTypes.debug, {
					screenId,
					shown: command.shown,
				})
			: delivery(channel, eventId, screenCommandMessageTypes[command.command], { screenId });

	try {
		await publishToEventOnceMore(eventId, [message]);
	} catch (error) {
		console.error(
			JSON.stringify({
				message: 'realtime_publish_failed',
				eventId,
				screenId,
				messageType: message.name,
				...publishFailureFields(error),
			}),
		);
		throw new RealtimePublishError(error);
	}
}
