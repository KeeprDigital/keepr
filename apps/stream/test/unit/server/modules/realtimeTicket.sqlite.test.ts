import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '~~/server/db/schema';
import {
	createD1RealtimeTickets,
	REALTIME_TICKET_LIFETIME_MS,
} from '~~/server/modules/realtime-ticket';
import { createSqliteD1Harness } from '@keepr/nuxt-layer/test/helpers/sqlite-d1';

// A Realtime Ticket (ADR-0137, ADR-0142) over real SQL: given only for a
// capability that is a Screen's in the Event asked for, and spent exactly once,
// while unexpired, for that Event, and while that capability is still the Screen's.

const harness = await createSqliteD1Harness();
const database = harness.database as unknown as D1Database;
const db = drizzle(harness.database, { schema });

let now = 1_000_000;
const tickets = createD1RealtimeTickets(database, () => now);

async function createEvent(): Promise<number> {
	const [event] = await db
		.insert(schema.events)
		.values({ name: 'Event', game: 'mtg', featureMatchOrientation: 'horizontal' })
		.returning({ id: schema.events.id });
	return event!.id;
}

/** Not the column's default, so a version answered is one read from the Screen. */
const CAPABILITY_VERSION = 4;

let screens = 0;
/** A Screen of `eventId` whose capability's digest is the one answered. */
async function createScreen(eventId: number): Promise<{ id: number; capabilityDigest: string }> {
	screens += 1;
	const capabilityDigest = `capability-digest-${screens}`;
	const [screen] = await db
		.insert(schema.screens)
		.values({
			eventId,
			name: 'Main',
			slug: `screen-${screens}`,
			assetCapabilitySeed: `seed-${screens}`,
			assetCapabilityDigest: capabilityDigest,
			assetCapabilityVersion: CAPABILITY_VERSION,
		})
		.returning({ id: schema.screens.id });
	return { id: screen!.id, capabilityDigest };
}

/** What a ticket spent for `screen` answers. */
const admitted = () => ({ screenId: screen.id, capabilityVersion: CAPABILITY_VERSION });

const storedTickets = async () => await db.select().from(schema.realtimeTickets);

let eventId: number;
let screen: { id: number; capabilityDigest: string };

beforeEach(async () => {
	await db.delete(schema.realtimeTickets);
	eventId = await createEvent();
	screen = await createScreen(eventId);
});

afterAll(async () => await harness.close());

/** A ticket for `screen`, as its Screen Output is given one. */
async function given(): Promise<string> {
	const ticket = await tickets.give({ capabilityDigest: screen.capabilityDigest, eventId });
	return ticket!.ticket;
}

describe('giving a Realtime Ticket', () => {
	it("gives the capability's Screen a URL-safe ticket that lasts 30 s, and stores no ticket", async () => {
		const ticket = await tickets.give({ capabilityDigest: screen.capabilityDigest, eventId });

		expect(ticket!.ticket).toMatch(/^[\w-]{43}$/);
		expect(ticket!.expiresAt).toEqual(new Date(now + 30_000));
		const [row] = await storedTickets();
		expect(row).toMatchObject({
			eventId,
			screenId: screen.id,
			capabilityDigest: screen.capabilityDigest,
			expiresAt: new Date(now + 30_000),
		});
		expect(JSON.stringify(row)).not.toContain(ticket!.ticket);
	});

	it.each([
		['is no Screen’s', async () => ({ capabilityDigest: 'no-screens-digest', eventId })],
		[
			'is a Screen’s of another Event',
			async () => ({ capabilityDigest: screen.capabilityDigest, eventId: await createEvent() }),
		],
	])('gives none for a capability that %s, and writes nothing', async (_case, input) => {
		// An expired ticket the next ticket given would delete: a refusal is a read alone.
		await given();
		now += REALTIME_TICKET_LIFETIME_MS;
		const before = await storedTickets();

		expect(await tickets.give(await input())).toBeNull();
		expect(await storedTickets()).toEqual(before);
		expect(before).toHaveLength(1);
	});

	it('deletes the tickets that expired unspent, and keeps the ones that could still be spent', async () => {
		await given();
		now += REALTIME_TICKET_LIFETIME_MS - 1;
		const live = await given();
		now += 1;

		await given();

		expect(await storedTickets()).toHaveLength(2);
		expect(await tickets.spend({ ticket: live, eventId })).toEqual(admitted());
	});
});

describe('spending a Realtime Ticket', () => {
	it('admits the Screen it was given for until the moment it expires', async () => {
		const ticket = await given();
		now += REALTIME_TICKET_LIFETIME_MS - 1;

		expect(await tickets.spend({ ticket, eventId })).toEqual(admitted());
	});

	it('admits one of two sockets that present it at once', async () => {
		const ticket = await given();

		const answers = await Promise.all([
			tickets.spend({ ticket, eventId }),
			tickets.spend({ ticket, eventId }),
		]);

		expect(answers.filter(Boolean)).toEqual([admitted()]);
	});

	it.each<[string, (ticket: string) => Promise<{ ticket: string; eventId: number }>]>([
		[
			'has expired',
			async (ticket) => {
				now += REALTIME_TICKET_LIFETIME_MS;
				return { ticket, eventId };
			},
		],
		[
			'was spent before',
			async (ticket) => {
				await tickets.spend({ ticket, eventId });
				return { ticket, eventId };
			},
		],
		['was given for another Event', async (ticket) => ({ ticket, eventId: await createEvent() })],
		[
			'was given for a capability regenerated since',
			async (ticket) => {
				await db
					.update(schema.screens)
					.set({ assetCapabilityDigest: 'regenerated-digest', assetCapabilityVersion: 2 })
					.where(eq(schema.screens.id, screen.id));
				return { ticket, eventId };
			},
		],
		['is not the shape of one', async (ticket) => ({ ticket: `${ticket}A`, eventId })],
		[
			'was never given',
			async (ticket) => ({
				ticket: (ticket.startsWith('A') ? 'B' : 'A') + ticket.slice(1),
				eventId,
			}),
		],
	])('admits nobody with a ticket that %s', async (_case, presented) => {
		const ticket = await given();

		expect(await tickets.spend(await presented(ticket))).toBeNull();
	});

	it('is spent by the socket it refused: presented for another Event, it no longer admits its own', async () => {
		const ticket = await given();
		await tickets.spend({ ticket, eventId: await createEvent() });

		expect(await tickets.spend({ ticket, eventId })).toBeNull();
	});
});
