import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createSqliteD1Harness } from '@keepr/nuxt-layer/test/helpers/sqlite-d1';

// A Commander Event is produced from its Feature Match Slots alone (ADR-0087):
// each write module refuses what it does not have, whichever route or caller asks.

vi.stubGlobal(
	'createError',
	(input: { statusCode?: number; message?: string; statusMessage?: string }) =>
		Object.assign(new Error(input.message ?? input.statusMessage ?? 'error'), input),
);

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });
const published = vi.fn();

vi.doMock('~~/server/db', () => ({ db }));
vi.doMock('~~/server/utils/realtimePublish', () => ({
	publishMessage: published,
	publishMessageStrict: published,
	publishScreenCommand: published,
	getOriginConnectionId: () => undefined,
}));

const { playerUpdateModule } = await import('~~/server/modules/player-update');
const { playerListWriteModule } = await import('~~/server/modules/player-list-write');
const { roundWriteModule } = await import('~~/server/modules/round-write');
const { matchWriteModule } = await import('~~/server/modules/match-write');
const { featureMatchAssignmentModule } = await import('~~/server/modules/feature-match-assignment');
const { featureMatchPromotionModule } = await import('~~/server/modules/feature-match-promotion');
const { archetypeWriteModule } = await import('~~/server/modules/archetype-write');

afterAll(async () => await harness.close());

const [commander] = await db
	.insert(schema.events)
	.values({
		name: 'Commander Night',
		game: 'mtg',
		variant: 'commander',
		featureMatchOrientation: 'horizontal',
	})
	.returning({ id: schema.events.id });
const eventId = commander!.id;

describe('a Commander Event', () => {
	it.each([
		{
			module: 'player-update',
			write: () => playerUpdateModule().createPlayer({ eventId, input: { name: 'Ada' } as never }),
			table: schema.players,
		},
		{
			module: 'player-list-write',
			write: () =>
				playerListWriteModule().createPlayerList({ eventId, input: { name: 'Top 8' } as never }),
			table: schema.playerLists,
		},
		{
			module: 'round-write',
			write: () =>
				roundWriteModule().create({
					eventId,
					input: { phaseId: 1, name: 'Round 1', roundNumber: 1 } as never,
				}),
			table: schema.rounds,
		},
		{
			module: 'match-write',
			write: () =>
				matchWriteModule().create({ eventId, input: { roundId: 1, tableNumber: 1 } as never }),
			table: schema.matches,
		},
		{
			module: 'feature-match-assignment',
			write: () =>
				featureMatchAssignmentModule().save(eventId, {
					roundId: 1,
					slotId: 1,
					matchId: 1,
				} as never),
			table: schema.featureMatchAssignments,
		},
		{
			module: 'feature-match-promotion',
			write: () =>
				featureMatchPromotionModule().promoteMatchToSlot({ eventId, slotId: 1, matchId: 1 }),
			table: schema.featureMatchAssignments,
		},
		{
			module: 'archetype-write',
			write: () => archetypeWriteModule().createArchetype({ eventId, input: { name: 'Atraxa' } }),
			table: schema.archetypes,
		},
	])('refuses a $module write, storing nothing', async ({ write, table }) => {
		await expect(write()).rejects.toMatchObject({
			statusCode: 400,
			statusMessage: expect.stringContaining('A Commander Event has no'),
		});

		expect(await db.select().from(table).where(eq(table.eventId, eventId))).toEqual([]);
		expect(published).not.toHaveBeenCalled();
	});
});
