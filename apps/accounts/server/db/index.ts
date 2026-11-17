import type { AnyD1Database } from 'drizzle-orm/d1';
import process from 'node:process';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';

export { schema };

/** The identity database, which only Keepr Accounts opens (ADR-0112). */
export type IdentityDatabase = ReturnType<typeof drizzle<typeof schema>>;

/** The identity database over a D1 binding, or over the test harness's stand-in for one. */
export function identityDatabase(binding: AnyD1Database): IdentityDatabase {
	return drizzle(binding, { schema });
}

let database: IdentityDatabase | undefined;

/**
 * The Worker's `DB` binding, looked up on first use rather than at import: Nitro
 * places it on `process.env` or `globalThis.__env__` once a request arrives.
 */
export function db(): IdentityDatabase {
	if (!database) {
		const binding =
			(process.env as Record<string, unknown>).DB ||
			(globalThis as { __env__?: { DB?: unknown } }).__env__?.DB;
		if (!binding) throw new Error('DB binding not found');
		database = identityDatabase(binding as AnyD1Database);
	}
	return database;
}
