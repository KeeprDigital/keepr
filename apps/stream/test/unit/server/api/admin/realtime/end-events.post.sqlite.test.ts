import type { H3Event } from 'h3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { installRealtimeObjectFake } from '~~/test/helpers/realtimeObjectFake';
import { createSqliteD1Harness } from '@keepr/nuxt-layer/test/helpers/sqlite-d1';

// POST /api/admin/realtime/end-events over real SQL (ADR-0162): every Event id
// ever issued is ended as deleting its Event ends it, before a wipe or restore
// hands the id out again. Only the realtime object is faked.

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler);
vi.stubGlobal(
	'readValidatedBody',
	async (event: { body: unknown }, parse: (value: unknown) => unknown) => parse(event.body),
);
vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input),
);

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });
vi.doMock('~~/server/db', () => ({ db }));
const administrator = vi.fn();
vi.doMock('~~/server/modules/graphics-administrator', () => ({
	requireGraphicsAdministrator: administrator,
}));

const realtime = await installRealtimeObjectFake();

type Handler = (event: H3Event) => Promise<Record<string, unknown>>;
const endEvents = (await import('~~/server/api/admin/realtime/end-events.post'))
	.default as unknown as Handler;

const request = (body: unknown) => ({ body }) as unknown as H3Event;

async function createEvent(): Promise<number> {
	const [event] = await db
		.insert(schema.events)
		.values({ name: 'Event', game: 'mtg', featureMatchOrientation: 'horizontal' })
		.returning({ id: schema.events.id });
	return event!.id;
}

// Three ids issued, the last deleted: a wipe would hand all three out again.
const [first, , last] = [await createEvent(), await createEvent(), await createEvent()];
await db.delete(schema.events).where(eq(schema.events.id, last!));

beforeEach(() => {
	realtime.reset();
	administrator.mockReset().mockResolvedValue('admin-user');
});

afterAll(async () => await harness.close());

describe('ending every Event’s realtime', () => {
	it('tells and closes the object of every Event id issued, the deleted ones too', async () => {
		const answered = await endEvents(request({}));

		const ids = [first!, first! + 1, last!];
		expect(answered).toEqual({ from: 1, through: last, highestEventId: last, failed: [] });
		expect(realtime.disconnects.map(({ scope }) => scope)).toEqual(
			Array.from({ length: last! }, (_, index) => `event:${index + 1}`),
		);
		for (const id of ids)
			expect(realtime.on(`event:${id}`)).toEqual([
				expect.objectContaining({ type: 'event:deleted' }),
			]);
	});

	it('ends a range at a time, so one call stays within what a request may ask', async () => {
		const answered = await endEvents(request({ from: 2, through: 2 }));

		expect(answered).toMatchObject({ from: 2, through: 2 });
		expect(realtime.disconnects.map(({ scope }) => scope)).toEqual(['event:2']);
	});

	it('names the Events whose sockets could not be closed, so they are ended again', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		realtime.refuseDisconnect(2);

		expect(await endEvents(request({ from: 1, through: 2 }))).toMatchObject({ failed: [1] });
	});

	it.each([
		['longer than one call may end', { from: 1, through: 1000 }],
		['that ends before it starts', { from: 5, through: 4 }],
	])('refuses a range %s', async (_case, range) => {
		await expect(endEvents(request(range))).rejects.toMatchObject({ statusCode: 400 });
		expect(realtime.disconnects).toEqual([]);
	});

	it('is a Graphics Administrator’s alone', async () => {
		administrator.mockRejectedValue(Object.assign(new Error('Forbidden'), { statusCode: 403 }));

		await expect(endEvents(request({}))).rejects.toMatchObject({ statusCode: 403 });
		expect(realtime.disconnects).toEqual([]);
	});
});
