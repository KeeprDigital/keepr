import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import { getTableConfig } from 'drizzle-orm/sqlite-core';

/**
 * A hand-written Drizzle schema held to the table contract Better Auth derives
 * from an app's own options (`getAuthTables`). Better Auth's CLI is versioned
 * apart from the library, so an app's auth schema is kept by hand; a library
 * bump that adds, renames or retypes a field breaks a rule here, the signal that
 * a migration is owed.
 *
 * The Drizzle adapter resolves a column by its property key, which must equal the
 * library's field name; the SQL name underneath is snake_case. The layer does not
 * depend on Better Auth, so the contract is read by shape.
 */

/** One field of a model, as `getAuthTables` describes it. */
export interface AuthContractField {
	type: unknown;
	fieldName?: string;
	required?: boolean;
	unique?: boolean;
	index?: boolean;
	references?: { model: string; field: string; onDelete?: string };
}

/** One model, as `getAuthTables` describes it. */
export interface AuthContractModel {
	modelName: string;
	fields: Record<string, AuthContractField>;
}

/** What breaks one rule: a line for each table or column that does, none when it holds. */
export type AuthSchemaCheck = (
	contract: readonly AuthContractModel[],
	schema: Readonly<Record<string, unknown>>,
) => string[];

const SQL_TYPE_BY_FIELD_TYPE: Record<string, string> = {
	string: 'text',
	boolean: 'integer',
	date: 'integer',
	number: 'integer',
};

function snakeCase(name: string): string {
	return name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

interface ModelTable {
	model: AuthContractModel;
	config: ReturnType<typeof getTableConfig>;
	columnsByKey: Map<string, SQLiteColumn>;
}

/** Each model whose table the schema exports, with its columns by property key. */
function tablesOf(contract: readonly AuthContractModel[], schema: Readonly<Record<string, unknown>>) {
	return contract.flatMap((model): ModelTable[] => {
		const table = schema[model.modelName] as SQLiteTable | undefined;
		if (!table) return [];
		const config = getTableConfig(table);
		const columnsByKey = new Map(
			Object.entries(table).filter(([, value]) => config.columns.includes(value as never)) as [
				string,
				SQLiteColumn,
			][],
		);
		return [{ model, config, columnsByKey }];
	});
}

/** Each contract field with its column, where the table has one. */
function fieldsOf(contract: readonly AuthContractModel[], schema: Readonly<Record<string, unknown>>) {
	return tablesOf(contract, schema).flatMap(({ model, config, columnsByKey }) =>
		Object.entries(model.fields).flatMap(([key, field]) => {
			const name = field.fieldName ?? key;
			const column = columnsByKey.get(name);
			return column ? [{ at: `${model.modelName}.${name}`, name, field, column, config }] : [];
		}),
	);
}

/** One rule per row: a table that breaks the contract breaks exactly the rule it should. */
export const AUTH_SCHEMA_CONTRACT: readonly (readonly [rule: string, check: AuthSchemaCheck])[] = [
	[
		'every model is a table exported under its name',
		(contract, schema) =>
			contract.flatMap(({ modelName }) => {
				const table = schema[modelName] as SQLiteTable | undefined;
				if (!table) return [`${modelName}: no export`];
				const named = getTableConfig(table).name;
				return named === modelName ? [] : [`${modelName}: named ${named}`];
			}),
	],
	[
		'a table carries exactly its model’s fields and id',
		(contract, schema) =>
			tablesOf(contract, schema).flatMap(({ model, columnsByKey }) => {
				const expected = new Set([
					'id',
					...Object.entries(model.fields).map(([key, field]) => field.fieldName ?? key),
				]);
				return [
					...[...expected].filter((key) => !columnsByKey.has(key)).map((key) => `missing ${key}`),
					...[...columnsByKey.keys()].filter((key) => !expected.has(key)).map((key) => `extra ${key}`),
				].map((problem) => `${model.modelName}: ${problem}`);
			}),
	],
	[
		'id is the text primary key',
		(contract, schema) =>
			tablesOf(contract, schema).flatMap(({ model, columnsByKey }) => {
				const id = columnsByKey.get('id');
				return id?.primary && id.getSQLType() === 'text' ? [] : [`${model.modelName}.id`];
			}),
	],
	[
		'a column’s SQL name is its field’s in snake_case',
		(contract, schema) =>
			fieldsOf(contract, schema)
				.filter(({ name, column }) => column.name !== snakeCase(name))
				.map(({ at, column }) => `${at}: ${column.name}`),
	],
	[
		'a column has its field’s SQL type',
		(contract, schema) =>
			fieldsOf(contract, schema)
				.filter(({ field, column }) => column.getSQLType() !== SQL_TYPE_BY_FIELD_TYPE[String(field.type)])
				.map(({ at, column }) => `${at}: ${column.getSQLType()}`),
	],
	[
		'a column is NOT NULL exactly when its field is required',
		(contract, schema) =>
			fieldsOf(contract, schema)
				.filter(({ field, column }) => column.notNull !== (field.required === true))
				.map(({ at }) => at),
	],
	[
		'a column is unique exactly when its field is',
		(contract, schema) =>
			fieldsOf(contract, schema)
				.filter(({ field, column }) => column.isUnique !== (field.unique === true))
				.map(({ at }) => at),
	],
	[
		'a column references what its field does, with its delete rule, or nothing',
		(contract, schema) =>
			fieldsOf(contract, schema).flatMap(({ at, field, column, config }) => {
				const foreignKey = config.foreignKeys.find((candidate) =>
					candidate.reference().columns.some((referencing) => referencing.name === column.name),
				);
				const reference = foreignKey?.reference();
				const actual = reference && {
					model: getTableConfig(reference.foreignTable).name,
					field: reference.foreignColumns.map((target) => target.name).join(),
					onDelete: foreignKey!.onDelete,
				};
				const expected = field.references && {
					model: field.references.model,
					field: field.references.field,
					onDelete: field.references.onDelete,
				};
				return JSON.stringify(actual) === JSON.stringify(expected) ? [] : [at];
			}),
	],
	[
		'a column is indexed wherever its field asks',
		(contract, schema) =>
			fieldsOf(contract, schema)
				.filter(
					({ field, column, config }) =>
						field.index === true &&
						!config.indexes.some((entry) =>
							entry.config.columns.some(
								(indexColumn) => 'name' in indexColumn && indexColumn.name === column.name,
							),
						),
				)
				.map(({ at }) => at),
	],
];
