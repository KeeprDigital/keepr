# ADR-0071: The migrations unreleased at v1.5.0 are squashed into one, and journal numbers are never reserved

Accepted · 2026-11-04 · [#953](https://github.com/KeeprDigital/stream-keepr/issues/953). Amends ADR-0019. · Amended by ADR-0083: `0001_since_v1_5_0.sql` and its held-back tests are gone, squashed into the baseline once production's database was to be wiped. The numbering rule stands.

### Decision

**The 21 migrations merged after v1.5.0 become one, `0001_since_v1_5_0.sql`.** v1.5.0, the production release, had applied only `0000_baseline`. The originals are concatenated verbatim in their order, each under a `-- Section: <name>` comment, so every backfill, rewrite and trigger runs as it did. Their numbers had run 0001–0016 and then 0020–0024. The squash makes file numbers match journal positions again. It is a one-time repair, not a release step: later releases ship their migrations as they are.

**The next migration takes the next journal number** (README § Database). A branch never reserves a number ahead, and it does not rename a file to claim one. `migrationJournal.test.ts` fails on a gap.

### Why

drizzle-kit numbers a new migration by its count of journal entries and diffs against the snapshot that sorts last. With the gap, every `pnpm db:generate` produced a file that needed a hand rename, and a missed rename produced a duplicate migration. Production has applied none of the 21, so they could be rewritten without touching its `_hub_migrations`; ADR-0019's window closed only for what has shipped.

Concatenation rather than a regenerated diff keeps the hand-written data statements that drizzle-kit cannot emit. One file rather than a renumbered 0001–0021 moves production from v1.5.0 to the next release in one recorded step. Wrangler sends a migration and its `_hub_migrations` row as a single query. A renumber would keep 21 recorded points where a failed deploy could stop, in states no release ever ran.

### Consequences

- The held-back migration tests hold back at `0000`, so they arrange rows in production's schema, not some unreleased intermediate one.
- A local D1 that applied the old names needs a one-time reset (README § Database). Production needs none, but before the first deploy carrying this, its `_hub_migrations` must list only `0000_baseline.sql`.
- Earlier ADRs that named a numbered migration now name `0001_since_v1_5_0`, and its section where that helps.

### Rejected alternatives

- **Renumber to 0001–0021.** Keeps the per-migration files, but production would take 21 separately recorded steps for one release, and the held-back tests would keep arranging rows in intermediate schemas no deployed database will hold.
- **Regenerate one diff from the baseline snapshot.** It would drop the backfills and the Deck-source triggers that drizzle-kit cannot generate.
