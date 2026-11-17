import { getAuthTables } from 'better-auth/db';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { describe, expect, it } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createEmailRecorder } from '~~/server/email/recorder';
import { authOptions } from '~~/server/utils/authOptions';

/**
 * The hand-written identity schema, held to the table contract Better Auth derives
 * from Keepr Accounts' own options. A library bump that adds, renames or retypes a
 * field fails here, which is the signal that a migration is owed.
 *
 * The Drizzle adapter resolves a column by its property key, which must equal the
 * library's field name; the SQL name underneath is snake_case.
 */

const tables = getAuthTables(
	authOptions({ sharedCookieDomain: undefined, email: createEmailRecorder() }),
);

function snakeCase(name: string): string {
	return name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

const sqlTypeByFieldType: Record<string, string> = {
	string: 'text',
	boolean: 'integer',
	date: 'integer',
	number: 'integer',
};

describe('the identity schema', () => {
	it('exports one table per model of the chosen add-ons, under the model name', () => {
		const modelNames = Object.values(tables)
			.map((table) => table.modelName)
			.toSorted();
		expect(modelNames).toEqual([
			'account',
			'invitation',
			'jwks',
			'member',
			'organization',
			'rateLimit',
			'session',
			'user',
			'verification',
		]);

		for (const { modelName } of Object.values(tables)) {
			const table = schema[modelName as keyof typeof schema];
			expect(table, `missing export for model "${modelName}"`).toBeDefined();
			expect(getTableConfig(table).name).toBe(modelName);
		}
	});

	describe.each(Object.values(tables).map((table) => [table.modelName, table] as const))(
		'model %s',
		(modelName, model) => {
			const table = schema[modelName as keyof typeof schema];
			const config = getTableConfig(table);
			const columnsByKey = new Map(
				Object.entries(table).filter(([, value]) => config.columns.includes(value as never)),
			);

			it('carries exactly the contract fields plus id', () => {
				const expectedKeys = [
					'id',
					...Object.entries(model.fields).map(([key, field]) => field.fieldName ?? key),
				].toSorted();
				expect([...columnsByKey.keys()].toSorted()).toEqual(expectedKeys);
			});

			it('names id as the text primary key', () => {
				const id = columnsByKey.get('id')!;
				expect(id.primary).toBe(true);
				expect(id.getSQLType()).toBe('text');
			});

			describe.each(
				Object.entries(model.fields).map(
					([key, field]) => [field.fieldName ?? key, field] as const,
				),
			)('field %s', (fieldName, field) => {
				const column = columnsByKey.get(fieldName)!;

				it('exists with the snake_case SQL name and contract type', () => {
					expect(column).toBeDefined();
					expect(column.name).toBe(snakeCase(fieldName));
					expect(column.getSQLType()).toBe(sqlTypeByFieldType[field.type as string]);
				});

				it('matches the contract on required', () => {
					expect(column.notNull).toBe(field.required === true);
				});

				it('matches the contract on unique', () => {
					expect(column.isUnique).toBe(field.unique === true);
				});

				it('references what the contract names, with its delete rule, or nothing', () => {
					const foreignKey = config.foreignKeys.find((candidate) =>
						candidate.reference().columns.some((referencing) => referencing.name === column.name),
					);
					const reference = foreignKey?.reference();

					expect(
						reference && {
							model: getTableConfig(reference.foreignTable).name,
							field: reference.foreignColumns.map((target) => target.name).join(),
							onDelete: foreignKey!.onDelete,
						},
					).toEqual(
						field.references && {
							model: field.references.model,
							field: field.references.field,
							onDelete: field.references.onDelete,
						},
					);
				});

				it('is covered by an index wherever the contract asks for one', () => {
					const indexed = config.indexes.some((entry) =>
						entry.config.columns.some(
							(indexColumn) => 'name' in indexColumn && indexColumn.name === column.name,
						),
					);
					expect(indexed || field.index !== true).toBe(true);
				});
			});
		},
	);
});
