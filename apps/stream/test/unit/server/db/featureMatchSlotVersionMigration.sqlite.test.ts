import { afterAll, describe, expect, it } from 'vitest';
import { createSqliteD1Harness } from '@keepr/nuxt-layer/test/helpers/sqlite-d1';

// A Slot from before Slot versions starts at version 0, its Seats as they were.
const harness = await createSqliteD1Harness({ throughMigration: '0006' });

afterAll(async () => {
	await harness.close();
});

describe('the Feature Match Slot version migration', () => {
	it('gives an existing Slot version 0 and leaves its Seats alone', async () => {
		await harness.client.execute(`
			INSERT INTO events (id, name, game, feature_match_orientation)
			VALUES (1, 'Magic', 'mtg', 'horizontal')
		`);
		await harness.client.execute(`
			INSERT INTO feature_match_slots (id, event_id, player1_data)
			VALUES (1, 1, '{"name":"Ana"}')
		`);

		await harness.applyRemainingMigrations();

		const { rows } = await harness.client.execute(
			'SELECT version, player1_data FROM feature_match_slots',
		);
		expect(rows.map((row) => [row.version, row.player1_data])).toEqual([[0, '{"name":"Ana"}']]);
	});
});
