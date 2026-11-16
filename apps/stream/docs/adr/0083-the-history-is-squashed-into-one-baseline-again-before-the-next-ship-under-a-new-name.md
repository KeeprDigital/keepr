# ADR-0083: The history is squashed into one baseline again before the next ship, under a new name

Accepted · 2026-11-12 · [#1121](https://github.com/KeeprDigital/stream-keepr/issues/1121), [#953](https://github.com/KeeprDigital/stream-keepr/issues/953) · Amends ADR-0019 and ADR-0071

### Decision

**The eight migrations (`0000_baseline`, `0001_since_v1_5_0` and `0002`–`0007`) are replaced by one, `0000_baseline_2.sql`.** As in ADR-0019, drizzle-kit generates it from the current schema, and a hand-written tail adds the two things drizzle-kit cannot express: the `graphics_capacity_settings` seed row, and the two `screens` Deck-source triggers as ADR-0057 left them, Slot-side clause included. The partial unique indexes need no hand: they are in the schema, so they are generated. The journal has one entry and one snapshot.

**Every hand-written backfill over v1.5.0 rows is deleted, with the four held-back tests that proved them.** Production's database is wiped whole before the next release ships (the maintainer's decision on #1121; ADR-0037 had already settled it for stored Screen Mode config), so no row is left for one to rewrite.

**The baseline takes a new name, so a database that was not emptied fails the migration and is not skipped.** A human empties production's D1 of every table before the first deploy that carries this, and every local D1 is reset once (README § Database and § Deploy day).

### Why

ADR-0019's reasoning holds again: the backfills protect data that will not exist, and their tests only exercised them. Squashing also settles #953 for good. With one journal entry, the next migration is `0001`, and drizzle-kit numbers it right unaided.

Wrangler decides whether to run a migration by its name alone. v1.5.0's `_hub_migrations` lists `0000_baseline.sql`, so a rewritten file of that name would be skipped. Measured with `wrangler d1 migrations apply --local`: over a v1.5.0 database, the new content under the old name answers "No migrations to apply!"; under the new name it stops on "table `archetype_cards` already exists" with nothing applied, as it does over a database holding all eight. The deploy migrates before it replaces the Worker, and its verify proves liveness only (README § Deploy). A skipped baseline would have put the new Worker on v1.5.0's schema with every local gate green.

### Consequences

- **A human must empty production's D1 before the next deploy.** README § Deploy day, step 2, has the two ways: replace the database and commit its id to `wrangler.jsonc`, or drop every table in place. Missed, the deploy stops at `db:migrate:remote`, the v1.5.0 Worker keeps serving, and the `production` marker reads `pending`. The new database has no accounts, so the first admin is bootstrapped again; the R2 buckets are not touched.
- Every local D1 from before this is reset once, in each checkout and worktree: `rm -rf .wrangler/state && pnpm db:migrate`.
- **The schema is unchanged.** The eight migrations and the one were each applied to an empty database, by the test harness's splitter and by Wrangler's local D1, and compared table by table: columns with their types, defaults and nullability, foreign keys, every index including the automatic ones, triggers and rows. Both give 54 tables, 582 columns, 72 foreign keys, 116 named indexes (8 partial), 2 triggers and the one seed row. The new snapshot equals the old `0007` snapshot apart from its ids. Two things differ, and neither is schema: ten tables list their columns in schema order, where additions used to come last, and `events.theme_id` declares its foreign key as a table constraint.
- No held-back migration test exists. `createSqliteD1Harness({ throughMigration })` stays for the next data migration (README § Database). `baselineMigration.sqlite.test.ts` pins the hand-written tail, now with the Slot-side clause.
- ADR-0071's numbering rule stands. Earlier ADRs that named `0001_since_v1_5_0` or one of its backfills now say the migration is gone.

### Rejected alternatives

- **Keep the name `0000_baseline.sql`.** Fewer words to change, but a production database nobody emptied would skip it in silence. One emptied of tables but not of `_hub_migrations` would too, and the Worker would deploy onto no schema at all.
- **Delete the tests and keep `0001`–`0007`.** It leaves backfill SQL that runs on every fresh database, rewrites nothing, and has no test.
- **Concatenate the SQL by hand, as ADR-0071 did.** ADR-0071 concatenated to keep the backfills. With none to keep, generating gives the file and the snapshot `pnpm db:generate` diffs against, and nothing to transcribe wrongly.
