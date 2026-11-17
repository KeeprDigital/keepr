import type { AuthContractModel } from '../../helpers/authSchemaContract';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { describe, expect, it } from 'vitest';
import { AUTH_SCHEMA_CONTRACT } from '../../helpers/authSchemaContract';

// Each rule of the auth schema contract catches the one drift it names, and no
// other rule does, so a schema that passes them all is held to every one.

const contract: AuthContractModel[] = [
	{ modelName: 'user', fields: { email: { type: 'string', required: true, unique: true } } },
	{
		modelName: 'session',
		fields: {
			userId: {
				type: 'string',
				required: true,
				index: true,
				references: { model: 'user', field: 'id', onDelete: 'cascade' },
			},
			expiresAt: { type: 'date', required: true },
		},
	},
];

const user = sqliteTable('user', {
	id: text('id').primaryKey(),
	email: text('email').notNull().unique(),
});

type SessionColumns = {
	id?: unknown;
	userId?: unknown;
	expiresAt?: unknown;
	extra?: unknown;
};

/** The `session` table, as the contract asks unless `drift` says otherwise. */
function session(
	drift: { columns?: SessionColumns; indexed?: boolean; referenced?: boolean } = {},
) {
	const userId = text('user_id').notNull();
	return sqliteTable(
		'session',
		{
			id: text('id').primaryKey(),
			userId:
				drift.referenced === false
					? userId
					: userId.references(() => user.id, { onDelete: 'cascade' }),
			expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
			...(drift.columns as object),
		} as never,
		(table: Record<string, never>) =>
			drift.indexed === false ? [] : [index('session_user_id_idx').on(table.userId)],
	);
}

/** The rules a schema breaks. */
function broken(schema: Record<string, unknown>) {
	return AUTH_SCHEMA_CONTRACT.filter(([, check]) => check(contract, schema).length > 0).map(
		([rule]) => rule,
	);
}

describe('the auth schema contract', () => {
	it('holds for a schema as the contract asks', () => {
		expect(broken({ user, session: session() })).toEqual([]);
	});

	it.each<[string, Record<string, unknown>]>([
		['every model is a table exported under its name', { user }],
		[
			'a table carries exactly its model’s fields and id',
			{ user, session: session({ columns: { extra: text('extra') } }) },
		],
		[
			'id is the text primary key',
			{ user, session: session({ columns: { id: integer('id').primaryKey() } }) },
		],
		[
			'a column’s SQL name is its field’s in snake_case',
			{
				user,
				session: session({
					columns: { expiresAt: integer('expiresAt', { mode: 'timestamp_ms' }).notNull() },
				}),
			},
		],
		[
			'a column has its field’s SQL type',
			{ user, session: session({ columns: { expiresAt: text('expires_at').notNull() } }) },
		],
		[
			'a column is NOT NULL exactly when its field is required',
			{
				user,
				session: session({
					columns: { expiresAt: integer('expires_at', { mode: 'timestamp_ms' }) },
				}),
			},
		],
		[
			'a column is unique exactly when its field is',
			{
				user,
				session: session({
					columns: {
						expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull().unique(),
					},
				}),
			},
		],
		[
			'a column references what its field does, with its delete rule, or nothing',
			{ user, session: session({ referenced: false }) },
		],
		['a column is indexed wherever its field asks', { user, session: session({ indexed: false }) }],
	])('breaks only “%s” where that drifts', (rule, schema) => {
		expect(broken(schema)).toEqual([rule]);
	});
});
