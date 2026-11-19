import type { PresenceMember } from '@keepr/realtime/protocol';
import type { SocketTransport } from '@keepr/realtime/client';
import type { ScreenResponse } from '~~/shared/api';
import { CLOSE_REFUSED, PING, PONG } from '@keepr/realtime/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { eventRealtimeChannel, screenRealtimeChannel } from '../../shared/utils/realtimeChannels';
import { $fetch, fetch } from './client';
import { INTEGRATION_SIGNED_OUT_COOKIE } from './environment';
import { aUserWithoutAccess } from './identities';
import { executeIntegrationD1 } from './integrationD1';
import {
	connectRealtime,
	operatorPage,
	realtimeSocketUrl as socketUrl,
	until,
} from './realtimeFollower';

/**
 * Who a realtime socket lets in, on a running server (ADR-0137, ADR-0142): a
 * Session and a Screen Output each hear what they may and are refused the rest
 * by the Event's object, a Realtime Ticket admits one socket, and regenerating
 * a Screen Output Asset Capability closes the sockets it admitted.
 *
 * The port's branches are `test/unit/server/routes/realtime/port.sqlite.test.ts`
 * and a ticket's are `test/unit/server/modules/realtimeTicket.sqlite.test.ts`.
 * This is what only a server shows: the layer's hand-off asks the port, the
 * object holds each socket to its grant, and one ticket is spent once in D1.
 *
 * What a socket hears is what the app's own writes announce: an Event's rename
 * on its Event's channel, and a Screen command on that Screen's. Nothing
 * publishes for a test.
 */

/** What an Operator's page of this server sends with its socket. */
const OPERATOR_PAGE = operatorPage();

/** What renaming an Event announces, on its Event's channel. */
const EVENT_UPDATED = 'event:updated';
/** What the `identify` command sends a Screen, on that Screen's channel. */
const SCREEN_COMMANDED = 'screen:command:identify';

const transports: SocketTransport[] = [];
const sockets: WebSocket[] = [];
afterEach(() => {
	for (const transport of transports.splice(0)) transport.dispose();
	for (const socket of sockets.splice(0)) socket.close();
});

/** A page's socket by the client transport, with the headers its browser would send. */
function connect(
	address: () => string | Promise<string>,
	headers: Record<string, string> = {},
): SocketTransport {
	const transport = connectRealtime(address, headers);
	transports.push(transport);
	return transport;
}

/** Hear the messages named `name` on `channel`, once the object has attached it. */
async function hear(transport: SocketTransport, channel: string, name: string): Promise<any[]> {
	const heard: any[] = [];
	let attached = false;
	transport.onceAttached(channel, () => {
		attached = true;
	});
	transport.onMessage(channel, name, (data) => heard.push(data));
	await until(`${channel} to attach`, () => attached);
	return heard;
}

/** Rename the Event: the app announces it on the Event's channel. */
async function renameEvent(eventId: number, name: string): Promise<void> {
	await $fetch(`/api/events/${eventId}`, { method: 'PATCH', body: { name } });
}

/** Command a Screen to identify itself: the app sends it on that Screen's channel. */
async function commandScreen(eventId: number, screenId: number): Promise<void> {
	await $fetch(`/api/events/${eventId}/screens/${screenId}/command`, {
		method: 'POST',
		body: { command: 'identify' },
	});
}

type Attempt =
	/** Let in: `closed` answers the code it is later closed with. */
	| { admitted: true; socket: WebSocket; closed: Promise<number> }
	| { admitted: false; code: number };

/**
 * One socket, opened as given and nothing more: let in once the object answers
 * its ping, or not, with the code it was closed with. A refused socket opens
 * too, so opening says nothing.
 */
function open(
	query: Record<string, string | number>,
	headers: Record<string, string> = {},
): Promise<Attempt> {
	const socket = new WebSocket(socketUrl(query), { headers } as never);
	sockets.push(socket);
	let settleClosed: (code: number) => void;
	const closed = new Promise<number>((resolve) => {
		settleClosed = resolve;
	});
	return new Promise((resolve) => {
		socket.addEventListener('open', () => socket.send(PING));
		socket.addEventListener('message', ({ data }) => {
			if (data === PONG) resolve({ admitted: true, socket, closed });
		});
		socket.addEventListener('close', ({ code }) => {
			settleClosed(code);
			resolve({ admitted: false, code });
		});
	});
}

const REFUSED: Attempt = { admitted: false, code: CLOSE_REFUSED };

async function createEvent(): Promise<number> {
	const event = await $fetch<{ id: number }>('/api/events', {
		method: 'POST',
		body: { name: 'Realtime admission', game: 'mtg', featureMatchOrientation: 'horizontal' },
	});
	return event.id;
}

let screens = 0;
/** A Screen of `eventId`, its channel, and its Screen Output Asset Capability. */
async function createScreen(eventId: number) {
	screens += 1;
	const screen = await $fetch<ScreenResponse>(`/api/events/${eventId}/screens`, {
		method: 'POST',
		body: { name: `Output ${screens}`, slug: `realtime-admission-${eventId}-${screens}` },
	});
	const { assetCapability } = await $fetch<{ assetCapability: string }>(
		`/api/events/${eventId}/screens/${screen.id}/asset-capability`,
	);
	return {
		id: screen.id,
		channel: screenRealtimeChannel(eventId, screen.id),
		capability: assetCapability,
	};
}

/** Ask for a Realtime Ticket as a Screen Output does: its capability, and no Session. */
async function askForTicket(eventId: number | string, capability?: string) {
	const response = await fetch(`/api/realtime/ticket?eventId=${eventId}`, {
		method: 'POST',
		headers: {
			cookie: INTEGRATION_SIGNED_OUT_COOKIE,
			...(capability === undefined ? {} : { authorization: `Bearer ${capability}` }),
		},
	});
	return await answerOf(response);
}

async function answerOf(response: Response) {
	return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

/** What a refusal says to its caller: a dev server adds the request's own URL and a stack. */
const saying = ({ status, body }: Awaited<ReturnType<typeof answerOf>>) => ({
	status,
	statusMessage: body.statusMessage,
	message: body.message,
	data: body.data,
});

async function ticket(eventId: number, capability: string): Promise<string> {
	const { status, body } = await askForTicket(eventId, capability);
	expect(status).toBe(200);
	return body.ticket as string;
}

/** A Screen Output's socket by the client transport: a ticket for each socket it opens. */
function connectOutput(eventId: number, capability: string): SocketTransport {
	return connect(async () => socketUrl({ eventId, ticket: await ticket(eventId, capability) }));
}

const sorted = (transport: SocketTransport) =>
	transport.channelRefusals.map(({ channel, what }) => `${what} ${channel}`).toSorted();

describe('a Session', () => {
	it("hears its Event's channel and its Screens', and enters a Screen's presence", async () => {
		const eventId = await createEvent();
		const screen = await createScreen(eventId);
		const session = connect(() => socketUrl({ eventId }), OPERATOR_PAGE);
		const onEvent = await hear(session, eventRealtimeChannel(eventId), EVENT_UPDATED);
		const onScreen = await hear(session, screen.channel, SCREEN_COMMANDED);
		let members: PresenceMember[] = [];
		session.watchPresence(screen.channel, (now) => {
			members = now;
		});
		session.enterPresence(screen.channel, { as: 'an Operator' });

		await renameEvent(eventId, 'Heard by its Session');
		await commandScreen(eventId, screen.id);

		await until('both messages', () => onEvent.length === 1 && onScreen.length === 1);
		await until('its presence', () => members.length === 1);
		expect(onEvent).toEqual([
			expect.objectContaining({
				eventId,
				event: expect.objectContaining({ name: 'Heard by its Session' }),
			}),
		]);
		expect(onScreen).toEqual([expect.objectContaining({ eventId, screenId: screen.id })]);
		expect(members).toEqual([expect.objectContaining({ data: { as: 'an Operator' } })]);
		expect(session.channelRefusals).toEqual([]);
	});

	it("is refused another Event's channels and its own Event's presence, by the object", async () => {
		const [eventId, otherEventId] = [await createEvent(), await createEvent()];
		const session = connect(() => socketUrl({ eventId }), OPERATOR_PAGE);
		await hear(session, eventRealtimeChannel(eventId), EVENT_UPDATED);

		session.onMessage(eventRealtimeChannel(otherEventId), EVENT_UPDATED, () => {});
		session.onMessage(screenRealtimeChannel(otherEventId, 1), SCREEN_COMMANDED, () => {});
		session.enterPresence(eventRealtimeChannel(eventId), {});

		await until('the refusals', () => session.channelRefusals.length === 3);
		expect(sorted(session)).toEqual(
			[
				`attach ${eventRealtimeChannel(otherEventId)}`,
				`attach ${screenRealtimeChannel(otherEventId, 1)}`,
				`enter ${eventRealtimeChannel(eventId)}`,
			].toSorted(),
		);
	});

	it.each<[string, () => Promise<Record<string, string>> | Record<string, string>]>([
		[
			"another origin's page opens it",
			() => ({ ...OPERATOR_PAGE, origin: 'https://elsewhere.example' }),
		],
		['nobody is signed in', () => ({ ...OPERATOR_PAGE, cookie: INTEGRATION_SIGNED_OUT_COOKIE })],
		[
			'its User has no App access to Stream Keepr',
			async () => ({ ...OPERATOR_PAGE, cookie: await aUserWithoutAccess('realtime-outsider') }),
		],
	])('is refused its socket when %s, and let in otherwise', async (_case, headers) => {
		const eventId = await createEvent();

		expect(await open({ eventId }, await headers())).toEqual(REFUSED);
		expect(await open({ eventId }, OPERATOR_PAGE)).toMatchObject({ admitted: true });
	});

	it.each([
		['an Event that does not exist', { eventId: 2_000_000_000 }],
		['no Event', {}],
	])('is refused a socket that names %s', async (_case, query) => {
		expect(await open(query, OPERATOR_PAGE)).toEqual(REFUSED);
	});
});

describe('a Screen Output', () => {
	it("hears its own Screen's channel and enters its presence, with no Session", async () => {
		const eventId = await createEvent();
		const screen = await createScreen(eventId);
		const output = connectOutput(eventId, screen.capability);
		const heard = await hear(output, screen.channel, SCREEN_COMMANDED);
		let members: PresenceMember[] = [];
		output.watchPresence(screen.channel, (now) => {
			members = now;
		});
		output.enterPresence(screen.channel, { protocol: 2 });

		await commandScreen(eventId, screen.id);

		await until('the message', () => heard.length === 1);
		await until('its presence', () => members.length === 1);
		expect(heard).toEqual([expect.objectContaining({ eventId, screenId: screen.id })]);
		expect(output.channelRefusals).toEqual([]);
	});

	it("is refused its Event's channel and another Screen's, by the object, and hears nothing said there", async () => {
		const eventId = await createEvent();
		const [screen, otherScreen] = [await createScreen(eventId), await createScreen(eventId)];
		const output = connectOutput(eventId, screen.capability);
		const heard = await hear(output, screen.channel, SCREEN_COMMANDED);
		const elsewhere: unknown[] = [];

		output.onMessage(eventRealtimeChannel(eventId), EVENT_UPDATED, (data) => elsewhere.push(data));
		output.onMessage(otherScreen.channel, SCREEN_COMMANDED, (data) => elsewhere.push(data));
		output.enterPresence(otherScreen.channel, { protocol: 2 });
		await until('the refusals', () => output.channelRefusals.length === 3);
		await renameEvent(eventId, 'Not heard by its outputs');
		await commandScreen(eventId, otherScreen.id);
		await commandScreen(eventId, screen.id);

		// Commanded last, and one object orders an Event's messages: everything
		// before it was sent to whoever may hear it.
		await until('its own message', () => heard.length === 1);
		expect(elsewhere).toEqual([]);
		expect(sorted(output)).toEqual(
			[
				`attach ${eventRealtimeChannel(eventId)}`,
				`attach ${otherScreen.channel}`,
				`enter ${otherScreen.channel}`,
			].toSorted(),
		);
	});
});

describe('a Realtime Ticket', () => {
	it('is given for a capability of the Event asked for, to last 30 s', async () => {
		const eventId = await createEvent();
		const screen = await createScreen(eventId);
		const before = Date.now();

		const { status, body } = await askForTicket(eventId, screen.capability);

		expect(status).toBe(200);
		expect(body).toEqual({
			ticket: expect.stringMatching(/^[\w-]+$/),
			expiresAt: expect.any(String),
		});
		const lifetime = Date.parse(body.expiresAt as string) - before;
		expect(lifetime).toBeGreaterThanOrEqual(30_000);
		expect(lifetime).toBeLessThan(35_000);
	});

	it('is refused with one 401 that says nothing of which half was wrong', async () => {
		const [eventId, otherEventId] = [await createEvent(), await createEvent()];
		const screen = await createScreen(eventId);

		const refusals = [
			// A signed-in Operator who presents no capability: no Session stands in for one.
			await answerOf(await fetch(`/api/realtime/ticket?eventId=${eventId}`, { method: 'POST' })),
			await askForTicket(eventId),
			await askForTicket(eventId, `${screen.capability}x`),
			await askForTicket(otherEventId, screen.capability),
			await askForTicket(2_000_000_000, screen.capability),
			await askForTicket('not-an-id', screen.capability),
		];

		expect(refusals.map(saying)).toEqual(
			refusals.map(() => ({
				status: 401,
				statusMessage: 'Unauthorized',
				message: 'A Screen Output Asset Capability of this Event is required',
				data: undefined,
			})),
		);
	});

	it('admits one socket, and a second that presents it is refused', async () => {
		const eventId = await createEvent();
		const screen = await createScreen(eventId);
		const once = await ticket(eventId, screen.capability);

		expect(await open({ eventId, ticket: once })).toMatchObject({ admitted: true });
		expect(await open({ eventId, ticket: once })).toEqual(REFUSED);
	});

	it('admits one of two sockets that present it at once', async () => {
		const eventId = await createEvent();
		const screen = await createScreen(eventId);
		const once = await ticket(eventId, screen.capability);

		const attempts = await Promise.all([
			open({ eventId, ticket: once }),
			open({ eventId, ticket: once }),
		]);

		expect(attempts.filter(({ admitted }) => admitted)).toHaveLength(1);
		expect(attempts.filter(({ admitted }) => !admitted)).toEqual([REFUSED]);
	});

	it('admits nobody once it has expired', async () => {
		const eventId = await createEvent();
		const screen = await createScreen(eventId);
		const expired = await ticket(eventId, screen.capability);
		await executeIntegrationD1(
			`UPDATE realtime_tickets SET expires_at = ${Date.now() - 1} WHERE event_id = ${eventId}`,
		);

		expect(await open({ eventId, ticket: expired })).toEqual(REFUSED);
	});

	it.each<[string, (eventId: number, given: string) => Promise<Record<string, string | number>>]>([
		[
			"another Event's socket",
			async (_eventId, given) => ({ eventId: await createEvent(), ticket: given }),
		],
		['a socket that names no Event', async (_eventId, given) => ({ ticket: given })],
		[
			'a ticket nobody was given',
			async (eventId, given) => ({ eventId, ticket: given.split('').toReversed().join('') }),
		],
	])('admits nobody: %s', async (_case, query) => {
		const eventId = await createEvent();
		const screen = await createScreen(eventId);

		// No cookie, as an output sends none: this server's Accounts Stand-in would
		// vouch for it as a User, and the ticket is still what decides.
		expect(await open(await query(eventId, await ticket(eventId, screen.capability)))).toEqual(
			REFUSED,
		);
	});
});

describe('regenerating a Screen Output Asset Capability', () => {
	it("closes the Screen's sockets at once, tells its watchers, and leaves the former capability with no way back", async () => {
		const eventId = await createEvent();
		const [screen, otherScreen] = [await createScreen(eventId), await createScreen(eventId)];
		const unspent = await ticket(eventId, screen.capability);
		const output = await open({ eventId, ticket: await ticket(eventId, screen.capability) });
		const otherOutput = await open({
			eventId,
			ticket: await ticket(eventId, otherScreen.capability),
		});
		if (!output.admitted || !otherOutput.admitted) throw new Error('An output was refused');
		const operator = connect(() => socketUrl({ eventId }), OPERATOR_PAGE);
		let members: PresenceMember[] = [];
		operator.watchPresence(screen.channel, (now) => {
			members = now;
		});
		output.socket.send(JSON.stringify({ t: 'enter', channel: screen.channel, data: {} }));
		await until('the output to be present', () => members.length === 1);

		const regenerated = await $fetch<{ assetCapability: string; outputsClosed: boolean }>(
			`/api/events/${eventId}/screens/${screen.id}/asset-capability`,
			{ method: 'POST' },
		);

		expect(regenerated.outputsClosed).toBe(true);
		expect(await output.closed).toBe(CLOSE_REFUSED);
		await until('its watchers to be told', () => members.length === 0);
		// The former capability: its unspent ticket admits nobody, and it is given no other.
		expect(await open({ eventId, ticket: unspent })).toEqual(REFUSED);
		expect(await askForTicket(eventId, screen.capability)).toMatchObject({ status: 401 });
		// The new one is let in, and another Screen's output never left.
		expect(
			await open({ eventId, ticket: await ticket(eventId, regenerated.assetCapability) }),
		).toMatchObject({ admitted: true });
		const stillThere = new Promise((resolve) =>
			otherOutput.socket.addEventListener('message', ({ data }) => resolve(data), { once: true }),
		);
		otherOutput.socket.send(PING);
		expect(await stillThere).toBe(PONG);
	});
});

describe('deleting a Screen', () => {
	it("closes its outputs' sockets at once, tells its watchers, and leaves another Screen's", async () => {
		const eventId = await createEvent();
		const [screen, otherScreen] = [await createScreen(eventId), await createScreen(eventId)];
		const output = await open({ eventId, ticket: await ticket(eventId, screen.capability) });
		const otherOutput = await open({
			eventId,
			ticket: await ticket(eventId, otherScreen.capability),
		});
		if (!output.admitted || !otherOutput.admitted) throw new Error('An output was refused');
		const operator = connect(() => socketUrl({ eventId }), OPERATOR_PAGE);
		let members: PresenceMember[] = [];
		operator.watchPresence(screen.channel, (now) => {
			members = now;
		});
		output.socket.send(JSON.stringify({ t: 'enter', channel: screen.channel, data: {} }));
		await until('the output to be present', () => members.length === 1);

		await $fetch(`/api/events/${eventId}/screens/${screen.id}`, { method: 'DELETE' });

		expect(await output.closed).toBe(CLOSE_REFUSED);
		await until('its watchers to be told', () => members.length === 0);
		const stillThere = new Promise((resolve) =>
			otherOutput.socket.addEventListener('message', ({ data }) => resolve(data), { once: true }),
		);
		otherOutput.socket.send(PING);
		expect(await stillThere).toBe(PONG);
	});
});

describe("realtime's port", () => {
	it('answers no request from outside', async () => {
		const eventId = await createEvent();

		const response = await fetch(`/realtime/port?eventId=${eventId}`, { headers: OPERATOR_PAGE });

		expect(response.status).toBe(404);
		expect(await response.text()).not.toContain('admission');
	});
});
