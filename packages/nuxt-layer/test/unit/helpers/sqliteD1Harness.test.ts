import type { SqliteD1Harness } from '../../helpers/sqlite-d1';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSqliteD1Harness } from '../../helpers/sqlite-d1';

/**
 * Drizzle's D1 driver reads `raw()` rows positionally. A libSQL row names only the first
 * column bearing a name, so a name-keyed rebuild silently collapses `a.id` and `b.id` on
 * every join; no consumer suite can see that.
 */

let harness: SqliteD1Harness;

beforeAll(async () => {
	// The layer has no migrations of its own: an empty database.
	harness = await createSqliteD1Harness({
		migrationsDirectory: mkdtempSync(join(tmpdir(), 'no-migrations-')),
	});
	await harness.client.execute('CREATE TABLE left_table (id INTEGER, name TEXT)');
	await harness.client.execute('CREATE TABLE right_table (id INTEGER, name TEXT)');
	// Two rows on the left, so every assertion below is about a set of rows rather than
	// a single one: a `raw()` that answered only the first would otherwise satisfy both
	// tests. Ordered explicitly wherever they are read, so neither test rests on the
	// order a scan happens to return.
	await harness.client.execute(`INSERT INTO left_table VALUES (1, 'alpha')`);
	await harness.client.execute(`INSERT INTO left_table VALUES (2, 'bravo')`);
	await harness.client.execute(`INSERT INTO right_table VALUES (99, 'beta')`);
});

afterAll(async () => await harness.close());

describe('the libSQL D1 harness', () => {
	it('answers raw() by column position, so a join keeps both tables’ values apart', async () => {
		// Four columns, two distinct names. By name the first row reads
		// [1, 'alpha', 1, 'alpha']; D1 answers [1, 'alpha', 99, 'beta'], and so must this.
		// Two rows of it, so a `raw()` that answered only the first is caught here too.
		const rows = await harness.database
			.prepare(`
			SELECT left_table.id, left_table.name, right_table.id, right_table.name
			FROM left_table JOIN right_table
			ORDER BY left_table.id
		`)
			.raw<unknown[]>();

		expect(rows).toEqual([
			[1, 'alpha', 99, 'beta'],
			[2, 'bravo', 99, 'beta'],
		]);
	});

	it('keeps every column of a wide row, including the ones holding null, zero and the empty string', async () => {
		// Repeated names catch a name-keyed rebuild, the distinct-name count a length from
		// `Object.keys`, the zero and empty string a `||` for `??`, and the second row a
		// single-array answer (#211).
		const rows = await harness.database
			.prepare(`
			SELECT id, NULL AS missing, 0 AS id, '' AS name, name FROM left_table
			ORDER BY left_table.id
		`)
			.raw<unknown[]>();

		expect(rows).toEqual([
			[1, null, 0, '', 'alpha'],
			[2, null, 0, '', 'bravo'],
		]);
	});
});

// What D1 refuses, so a query that would fail its first production run fails here.
// Each bound is D1's documented limit; workerd answered the same at each one, but
// for strings, which production holds to 2 MB and a local workerd does not.
const placeholders = (count: number) => Array.from({ length: count }, () => '?').join(',');
const ids = (count: number) => Array.from({ length: count }, (_, index) => index);
/** Exactly `bytes` long: `SELECT '` and `' AS v` are fourteen bytes. */
const statementOf = (bytes: number) => `SELECT '${'x'.repeat(bytes - 14)}' AS v`;
const D1_STRING_LIMIT = 2_000_000;

describe('the libSQL D1 harness refuses what D1 refuses', () => {
	it.each([
		['a Date', new Date(0), /D1_TYPE_ERROR: Type 'object' not supported/],
		['a BigInt', 1n, /D1_TYPE_ERROR: Type 'bigint' not supported/],
		['undefined', undefined, /D1_TYPE_ERROR: Type 'undefined' not supported/],
		['a plain object', { id: 1 }, /D1_TYPE_ERROR: Type 'object' not supported/],
	])('refuses to bind %s', (_label, value, refusal) => {
		expect(() => harness.database.prepare('SELECT ? AS v').bind(value)).toThrow(refusal);
	});

	it.each([
		['null', null, null],
		['a boolean, as an integer', true, 1],
		['a byte array', new Uint8Array([7]), [7]],
	])('binds %s', async (_label, value, stored) => {
		const row = await harness.database.prepare('SELECT ? AS v').bind(value).first<{ v: unknown }>();
		expect(row?.v instanceof ArrayBuffer ? [...new Uint8Array(row.v)] : row?.v).toEqual(stored);
	});

	it.each([
		['a hundred bound parameters', 100, true],
		['a hundred and one', 101, false],
	])('runs a query of %s only within the limit', async (_label, count, accepted) => {
		const query = harness.database
			.prepare(`SELECT count(*) AS v FROM left_table WHERE id IN (${placeholders(count)})`)
			.bind(...ids(count))
			.all();
		if (accepted) await expect(query).resolves.toMatchObject({ results: [{ v: 2 }] });
		else await expect(query).rejects.toThrow(/too many SQL variables/);
	});

	it.each([
		['a statement of exactly 100,000 bytes', statementOf(100_000), true],
		['one of 100,001', statementOf(100_001), false],
		[
			'one whose characters are fewer but whose bytes are over',
			`SELECT '${'é'.repeat(50_000)}' AS v`,
			false,
		],
	])('runs %s only within the limit', async (_label, sql, accepted) => {
		const query = harness.database.prepare(sql).all();
		if (accepted) await expect(query).resolves.toMatchObject({ results: [{}] });
		else await expect(query).rejects.toThrow(/statement too long/);
	});

	it.each([
		['a string of exactly 2,000,000 bytes', 'x'.repeat(D1_STRING_LIMIT), true],
		['one of 2,000,001', 'x'.repeat(D1_STRING_LIMIT + 1), false],
		['a byte array over it', new Uint8Array(D1_STRING_LIMIT + 1), false],
	])('binds %s only within the limit', async (_label, value, accepted) => {
		const query = harness.database.prepare('SELECT length(?) AS v').bind(value).all();
		if (accepted) await expect(query).resolves.toMatchObject({ results: [{ v: D1_STRING_LIMIT }] });
		else await expect(query).rejects.toThrow(/string or blob too big/);
	});

	it.each([
		['two statements', 'SELECT 1 AS a; SELECT 2 AS b', false],
		['one with a trailing semicolon', 'SELECT 1 AS a;', true],
		['one with a semicolon inside a string', "SELECT ';' AS a", true],
		['one with a semicolon inside a comment', 'SELECT 1 AS a -- one; two\n', true],
	])('prepares %s only when it is one statement', async (_label, sql, accepted) => {
		const query = harness.database.prepare(sql).all();
		if (accepted)
			await expect(query).resolves.toMatchObject({ results: [{ a: expect.anything() }] });
		else await expect(query).rejects.toThrow(/one statement/);
	});

	it('refuses a batch whole when one of its statements is over a limit', async () => {
		const insert = harness.database.prepare('INSERT INTO right_table VALUES (?, ?)');
		const batch = harness.database.batch([
			insert.bind(500, 'within'),
			harness.database.prepare(statementOf(100_001)),
		]);
		await expect(batch).rejects.toThrow(/statement too long/);
		expect(await countOf('SELECT count(*) AS c FROM right_table WHERE id = 500')).toBe(0);
	});
});

describe('the libSQL D1 harness answers as D1 does', () => {
	it.each([
		['an insert', "INSERT INTO right_table VALUES (10, 'x'), (11, 'y') RETURNING id", 2],
		['an update', "UPDATE right_table SET name = 'z' WHERE id IN (10, 11) RETURNING id", 2],
		['a delete of nothing', 'DELETE FROM right_table WHERE id = 404 RETURNING id', 0],
		['a delete', 'DELETE FROM right_table WHERE id IN (10, 11) RETURNING id', 2],
	])('reports the changes of %s with RETURNING', async (_label, sql, changes) => {
		const { meta } = await harness.database.prepare(sql).run();
		expect(meta).toMatchObject({ changes, rows_written: changes, changed_db: changes > 0 });
	});

	it('reports the changes of a RETURNING statement in a batch', async () => {
		const [result] = await harness.database.batch([
			harness.database.prepare("INSERT INTO right_table VALUES (12, 'w') RETURNING id"),
		]);
		expect(result?.meta.changes).toBe(1);
		await harness.client.execute('DELETE FROM right_table WHERE id = 12');
	});

	it('answers a read with the meta fields D1 answers', async () => {
		const { meta } = await harness.database.prepare('SELECT id FROM left_table').all();
		expect(meta).toEqual({
			duration: 0,
			size_after: 0,
			rows_read: 2,
			rows_written: 0,
			last_row_id: expect.any(Number),
			changed_db: false,
			changes: 0,
		});
	});

	it('rolls a batch back whole when a later statement fails', async () => {
		const batch = harness.database.batch([
			harness.database.prepare("INSERT INTO right_table VALUES (20, 'rolled back')"),
			harness.database.prepare('INSERT INTO no_such_table VALUES (1)'),
		]);
		await expect(batch).rejects.toThrow(/no such table/);
		expect(await countOf('SELECT count(*) AS c FROM right_table WHERE id = 20')).toBe(0);
	});

	it('enforces foreign keys', async () => {
		await harness.client.execute('CREATE TABLE parent (id INTEGER PRIMARY KEY)');
		await harness.client.execute(
			'CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id) ON DELETE CASCADE)',
		);
		const orphan = harness.database.prepare('INSERT INTO child (parent_id) VALUES (5)').run();
		await expect(orphan).rejects.toThrow(/FOREIGN KEY constraint failed/);

		await harness.client.execute('INSERT INTO parent VALUES (1)');
		await harness.client.execute('INSERT INTO child (parent_id) VALUES (1)');
		await harness.database.prepare('DELETE FROM parent WHERE id = 1').run();
		expect(await countOf('SELECT count(*) AS c FROM child')).toBe(0);
	});
});

async function countOf(sql: string) {
	return await harness.database.prepare(sql).first<number>('c');
}
