import { drizzle } from 'drizzle-orm/d1';
import { afterAll, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createD1RealtimeTickets } from '~~/server/modules/realtime-ticket';
import { screenOutputAssetCapabilityDigest } from '~~/server/modules/screen-output-assets/capability';
import { stubH3Event } from '@keepr/nuxt-layer/test/helpers/h3Event';
import { createSqliteD1Harness } from '@keepr/nuxt-layer/test/helpers/sqlite-d1';

// `POST /api/realtime/ticket` (ADR-0137, ADR-0142): a Realtime Ticket for a Screen Output
// Asset Capability of the Event asked for, and one 401 for everything else. The Screens
// and tickets are real rows; whether a ticket admits is the ticket module's own test.

interface StubEvent {
	query: Record<string, unknown>;
	headers: Record<string, string>;
	responseHeaders: Record<string, unknown>;
}

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler);
vi.stubGlobal('getQuery', (event: StubEvent) => event.query);
vi.stubGlobal('getRequestHeader', (event: StubEvent, name: string) => event.headers[name]);
vi.stubGlobal('setResponseHeader', (event: StubEvent, name: string, value: unknown) => {
	event.responseHeaders[name] = value;
});
vi.stubGlobal('createError', (input: { statusCode: number; message: string }) =>
	Object.assign(new Error(input.message), input),
);

const harness = await createSqliteD1Harness();
const database = harness.database as unknown as D1Database;
const db = drizzle(harness.database, { schema });
vi.doMock('~~/server/modules/graphics-asset-library/runtime', () => ({
	graphicsCatalogueClient: () => database,
}));

const handler = (await import('~~/server/api/realtime/ticket.post')).default as unknown as (
	event: unknown,
) => Promise<{ ticket: string; expiresAt: string }>;

const CAPABILITY = 'a-screen-output-asset-capability';

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
		assetCapabilityDigest: await screenOutputAssetCapabilityDigest(CAPABILITY),
	})
	.returning({ id: schema.screens.id });

function request(query: Record<string, unknown>, authorization?: string): StubEvent {
	return {
		query,
		headers: authorization === undefined ? {} : { authorization },
		responseHeaders: {},
	};
}

afterAll(async () => await harness.close());

describe('POST /api/realtime/ticket', () => {
	it("gives the capability's Screen a ticket that admits one socket of its Event, for 30 s", async () => {
		const asked = request({ eventId: String(eventId) }, `Bearer ${CAPABILITY}`);
		const before = Date.now();

		const answer = await handler(stubH3Event(asked as never));

		expect(answer.ticket).toMatch(/^[\w-]+$/);
		expect(new Date(answer.expiresAt).toISOString()).toBe(answer.expiresAt);
		expect(Date.parse(answer.expiresAt) - before).toBeGreaterThanOrEqual(30_000);
		expect(Date.parse(answer.expiresAt) - Date.now()).toBeLessThanOrEqual(30_000);
		expect(asked.responseHeaders).toEqual({ 'cache-control': 'private, no-store' });
		expect(
			await createD1RealtimeTickets(database).spend({ ticket: answer.ticket, eventId }),
		).toEqual({ screenId: screen!.id });
	});

	it.each([
		['no capability', { eventId: String(eventId) }, undefined],
		['a capability that is no Screen’s', { eventId: String(eventId) }, `Bearer ${CAPABILITY}-x`],
		[
			'a capability of another Event’s Screen',
			{ eventId: String(otherEventId) },
			`Bearer ${CAPABILITY}`,
		],
		['an Event id that is not one', { eventId: '0x10' }, `Bearer ${CAPABILITY}`],
		['no Event id', {}, `Bearer ${CAPABILITY}`],
		['the capability under another scheme', { eventId: String(eventId) }, `Basic ${CAPABILITY}`],
	])('refuses %s with the one 401, and gives no ticket', async (_case, query, authorization) => {
		await db.delete(schema.realtimeTickets);

		await expect(
			handler(stubH3Event(request(query, authorization) as never)),
		).rejects.toMatchObject({
			statusCode: 401,
			message: 'A Screen Output Asset Capability of this Event is required',
		});
		expect(await db.select().from(schema.realtimeTickets)).toEqual([]);
	});
});
