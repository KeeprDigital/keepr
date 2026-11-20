import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createD1RealtimeTickets } from '~~/server/modules/realtime-ticket';
import { stubH3Event } from '@keepr/nuxt-layer/test/helpers/h3Event';
import { createSqliteD1Harness } from '@keepr/nuxt-layer/test/helpers/sqlite-d1';

// Stream Keepr's answer to realtime's port (ADR-0137, ADR-0142): a Session or a Realtime
// Ticket is let in with exactly its grant, and everyone else is `null`. Events, Screens and
// tickets are real rows; who Keepr Accounts says the request belongs to is stood in for.

interface StubEvent {
	query: Record<string, unknown>;
	headers: Record<string, string>;
}

const HOST = 'stream.keepr.example';

vi.stubGlobal('defineRealtimePort', (port: unknown) => port);
vi.stubGlobal('getQuery', (event: StubEvent) => event.query);
vi.stubGlobal('getRequestHeader', (event: StubEvent, name: string) => event.headers[name]);
vi.stubGlobal('getRequestURL', () => new URL(`https://${HOST}/realtime/port`));

const requestIdentity = vi.fn();
vi.mock('~~/server/utils/session', () => ({ requestIdentity }));

const harness = await createSqliteD1Harness();
const database = harness.database as unknown as D1Database;
const db = drizzle(harness.database, { schema });
vi.doMock('~~/server/db', () => ({ db }));
vi.doMock('~~/server/modules/graphics-asset-library/runtime', () => ({
	graphicsCatalogueClient: () => database,
}));

const port = (await import('~~/server/routes/realtime/port')).default as unknown as (
	event: unknown,
) => Promise<unknown>;

async function createEvent(): Promise<number> {
	const [event] = await db
		.insert(schema.events)
		.values({ name: 'Event', game: 'mtg', featureMatchOrientation: 'horizontal' })
		.returning({ id: schema.events.id });
	return event!.id;
}

const eventId = await createEvent();
const otherEventId = await createEvent();
const [screen] = await db
	.insert(schema.screens)
	.values({
		eventId,
		name: 'Main',
		slug: 'main',
		assetCapabilitySeed: 'seed',
		assetCapabilityDigest: 'capability-digest',
		// Not the column's default: the tag below names the version read.
		assetCapabilityVersion: 3,
	})
	.returning({ id: schema.screens.id });
const screenId = screen!.id;

/** A ticket for the Screen, as its Screen Output is given one. */
async function ticket(): Promise<string> {
	const given = await createD1RealtimeTickets(database).give({
		capabilityDigest: 'capability-digest',
		eventId,
	});
	return given!.ticket;
}

/** What a page of the app's own origin sends with its socket. */
const OWN_PAGE = { origin: `https://${HOST}` };

const asked = (query: Record<string, unknown>, headers: Record<string, string> = OWN_PAGE) =>
	port(stubH3Event({ query, headers } satisfies StubEvent));

const refusal = (statusCode: number) => Object.assign(new Error('refused'), { statusCode });

beforeEach(() => {
	requestIdentity.mockReset().mockResolvedValue({ user: { id: 'user-42' }, sessionId: 'session' });
});

afterAll(async () => await harness.close());

describe('a Session', () => {
	// The upgrade's answer is the runtime's: a renewal taken here would never
	// reach the browser, so it is left for the Session's next request (ADR-0162).
	it('is asked for without taking a renewed Session cookie', async () => {
		await asked({ eventId: String(eventId) });

		expect(requestIdentity).toHaveBeenCalledWith(expect.anything(), { passesCookies: false });
	});

	it("is let into its Event's scope to hear the Event and its Screens, and to enter a Screen's presence", async () => {
		expect(await asked({ eventId: String(eventId) })).toEqual({
			scope: `event:${eventId}`,
			grant: {
				identity: 'user:user-42',
				hear: [`event:${eventId}`, `screen:${eventId}:*`],
				enter: [`screen:${eventId}:*`],
				tags: ['user:user-42'],
			},
		});
	});

	// The boundary's rule for a request that changes state (ADR-0010), whose branches
	// are tested at `requestIsCrossSiteMutation`: an upgrade is a GET, which it admits.
	it.each([
		['a sibling host', { origin: 'https://score.keepr.example' }],
		['a host the browser calls same-site', { 'sec-fetch-site': 'same-site', ...OWN_PAGE }],
	])("is refused when another origin's page opens the socket: %s", async (_case, headers) => {
		expect(await asked({ eventId: String(eventId) }, headers)).toBeNull();
		expect(requestIdentity).not.toHaveBeenCalled();
	});

	it.each([
		['a signed-out visitor', () => requestIdentity.mockResolvedValue(null), eventId],
		[
			'a User with no App access to Stream Keepr',
			() => requestIdentity.mockRejectedValue(refusal(403)),
			eventId,
		],
		['an Event that does not exist', () => {}, 999_999],
	])('is refused for %s', async (_case, arrange, asksFor) => {
		arrange();

		expect(await asked({ eventId: String(asksFor) })).toBeNull();
	});

	// Not an answer about the caller: the layer passes the app's 503 on, and a page
	// retries it as a failed attempt.
	it('is neither let in nor refused while Keepr Accounts cannot be asked', async () => {
		const unavailable = refusal(503);
		requestIdentity.mockRejectedValue(unavailable);

		await expect(asked({ eventId: String(eventId) })).rejects.toBe(unavailable);
	});
});

describe('a Screen Output', () => {
	it("is let into its Event's scope to hear and enter its own Screen's channel, with no Session read", async () => {
		requestIdentity.mockRejectedValue(refusal(503));

		expect(await asked({ eventId: String(eventId), ticket: await ticket() }, {})).toEqual({
			scope: `event:${eventId}`,
			grant: {
				identity: `screen-output:${screenId}`,
				hear: [`screen:${eventId}:${screenId}`],
				enter: [`screen:${eventId}:${screenId}`],
				tags: [`screen-output:${screenId}`, `screen-output:${screenId}:capability:3`],
			},
		});
		expect(requestIdentity).not.toHaveBeenCalled();
	});

	it('is refused the second socket of one ticket', async () => {
		const once = await ticket();
		await asked({ eventId: String(eventId), ticket: once }, {});

		expect(await asked({ eventId: String(eventId), ticket: once }, {})).toBeNull();
	});

	it.each<[string, () => Promise<Record<string, unknown>>]>([
		[
			"another Event's socket",
			async () => ({ eventId: String(otherEventId), ticket: await ticket() }),
		],
		['a ticket named twice', async () => ({ eventId: String(eventId), ticket: ['a', 'b'] })],
		// The ticket decides alone: the Session that would be let in without it is not asked.
		[
			'no ticket to speak of, beside a Session',
			async () => ({ eventId: String(eventId), ticket: '' }),
		],
	])('is refused for %s', async (_case, query) => {
		expect(await asked(await query())).toBeNull();
		expect(requestIdentity).not.toHaveBeenCalled();
	});
});

describe('anyone', () => {
	it.each([
		['names no Event', {}],
		['names an Event by anything but its id', { eventId: '0x10' }],
		['names two Events', { eventId: ['1', '2'] }],
	])('is refused when the socket %s', async (_case, query) => {
		expect(await asked(query)).toBeNull();
		expect(await asked({ ...query, ticket: await ticket() })).toBeNull();
	});
});
