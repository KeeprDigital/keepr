import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, expect, it } from 'vitest';
import { timedD1 } from '~~/server/db/timedD1';
import * as schema from '~~/server/db/schema';
import { createWriteTiming } from '~~/server/utils/writeTiming';
import { createSqliteD1Harness } from '@keepr/nuxt-layer/test/helpers/sqlite-d1';

// A write's log line counts D1 as D1 bills it: one query per round trip.

const harness = await createSqliteD1Harness();
afterAll(async () => await harness.close());

it('counts each statement run alone, and each batch, as one query, answering what D1 answered', async () => {
	const timing = createWriteTiming(1);
	const db = drizzle(
		timedD1(harness.database as D1Database, async (work) => await timing.time('d1', work)),
		{ schema },
	);
	const event = { name: 'Timed', game: 'mtg', featureMatchOrientation: 'horizontal' } as const;

	const { id } = (await db.insert(schema.events).values(event).returning().get())!;
	const [renamed, read] = await db.batch([
		db.update(schema.events).set({ name: 'Renamed' }).where(eq(schema.events.id, id)),
		db.select().from(schema.events).where(eq(schema.events.id, id)),
	]);
	const found = await db.query.events.findFirst({ where: eq(schema.events.id, id) });
	await db.$client.prepare('select 1').run();
	await timing.time('publish', async () => {});

	expect(renamed.meta.changes).toBe(1);
	expect(read).toMatchObject([{ id, name: 'Renamed' }]);
	expect(found).toMatchObject({ id, name: 'Renamed' });
	expect(timing.fields({ method: 'POST', path: '/', statusCode: 200 })).toMatchObject({
		d1Queries: 4,
	});
	expect(harness.roundTrips()).toBe(4);
});
