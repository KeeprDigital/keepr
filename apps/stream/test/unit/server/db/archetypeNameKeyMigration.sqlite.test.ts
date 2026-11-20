import { afterAll, describe, expect, it } from 'vitest';
import { createSqliteD1Harness } from '@keepr/nuxt-layer/test/helpers/sqlite-d1';

// An Event holds one Archetype per name ignoring case and surrounding spaces,
// at the database: one it held twice before keeps the first and renames the rest.
const harness = await createSqliteD1Harness({ throughMigration: '0007' });

afterAll(async () => {
	await harness.close();
});

describe('the Archetype name key migration', () => {
	it("renames each later Archetype sharing an Event's name in another case, and then refuses one", async () => {
		await harness.client.execute(`
			INSERT INTO events (id, name, game, feature_match_orientation)
			VALUES (1, 'One', 'mtg', 'horizontal'), (2, 'Two', 'mtg', 'horizontal')
		`);
		await harness.client.execute(`
			INSERT INTO archetypes (id, event_id, name, created_at, updated_at)
			VALUES (1, 1, 'Burn', 0, 0), (2, 1, 'burn ', 0, 0), (3, 2, 'BURN', 0, 0)
		`);

		await harness.applyRemainingMigrations();

		const { rows } = await harness.client.execute('SELECT id, name FROM archetypes ORDER BY id');
		expect(rows.map((row) => [Number(row.id), row.name])).toEqual([
			[1, 'Burn'],
			[2, 'burn  (2)'],
			[3, 'BURN'],
		]);
		await expect(
			harness.client.execute(
				"INSERT INTO archetypes (event_id, name, created_at, updated_at) VALUES (2, ' burn', 0, 0)",
			),
		).rejects.toThrow('UNIQUE constraint failed');
	});
});
