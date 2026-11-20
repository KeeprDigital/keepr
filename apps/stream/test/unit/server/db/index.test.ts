import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Drizzle client over the Worker's D1 binding. The binding is looked up on
 * first use rather than at import, and a missing one fails at the use.
 */

/** Enough of a D1 binding for Drizzle to wrap, whose every statement answers `answered`. */
function binding(): D1Database {
	const statement = { first: async () => 'answered' };
	return {
		prepare: vi.fn(() => statement),
		batch: vi.fn(),
		exec: vi.fn(),
		dump: vi.fn(),
	} as unknown as D1Database;
}

async function freshModule() {
	vi.resetModules();
	return await import('~~/server/db');
}

describe('the database client', () => {
	const previousEnv = (globalThis as { __env__?: unknown }).__env__;

	beforeEach(() => {
		delete (globalThis as { __env__?: unknown }).__env__;
	});

	afterEach(() => {
		(globalThis as { __env__?: unknown }).__env__ = previousEnv;
	});

	it('imports without a binding, so a module graph can load before the Worker hands one over', async () => {
		await expect(freshModule()).resolves.toHaveProperty('db');
	});

	it('refuses at first use when the Worker has no DB binding', async () => {
		const { db } = await freshModule();

		expect(() => db.$client).toThrowError('DB binding not found');
	});

	// Through the write timing's wrapper (`server/db/timedD1.ts`), which answers what D1 answered.
	it("runs its statements on the Worker's DB binding", async () => {
		(globalThis as { __env__?: unknown }).__env__ = { DB: binding() };
		const { db } = await freshModule();

		await expect(db.$client.prepare('select 1').first()).resolves.toBe('answered');
	});
});
