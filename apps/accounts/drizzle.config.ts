import { defineConfig } from 'drizzle-kit';

// `pnpm db:generate` diffs the schema against the last migration's snapshot and
// writes the next migration beside it, where `wrangler.dev.jsonc` applies them.
export default defineConfig({
	dialect: 'sqlite',
	schema: 'server/db/schema.ts',
	out: 'server/db/migrations/sqlite',
});
