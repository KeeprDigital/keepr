# ADR-0148: verify:quick runs the quick gates of each project a change affects

Accepted · 2026-11-20 · [#1369](https://github.com/KeeprDigital/keepr/issues/1369), part of [#1343](https://github.com/KeeprDigital/keepr/issues/1343) · Amends ADR-0082 and ADR-0092

### Decision

**From the root, `pnpm verify:quick` runs the quick gates of each project the change affects, and no other.** It reads the same graph as CI's scope (`affectedProjects` in `packages/tooling/scripts/project-graph.mjs`, ADR-0147) over the files the checkout changes since it left `main`, committed or not. Markdown is left out, as CI's scope leaves it out. `packages/tooling/scripts/verify-quick.mjs` runs, one after another and stopping at the first failure:

1. the changeset check;
2. each affected project's quick gate, packages before apps: its `verify:quick` script, or else its `typecheck` and `test`;
3. the lint, last, because it reads the tsconfig each project's gates prepare.

With no `main` to measure from, every project is affected. Before this, the root ran every package's typecheck and tests and Score Keepr's and Keepr Accounts' full `verify`, builds included, and then Stream Keepr's quick gates.

**Each app has a `verify:quick` that checks the app alone.** Stream Keepr's is unchanged: typecheck, and the unit and Nuxt tests whose imports reach a changed file, with the changeset check and the lint. Score Keepr and Keepr Accounts gain one: typecheck, and Vitest's `--changed`, with no build. Run by the root, an app's `verify:quick` leaves out the changeset check and the lint (`KEEPR_VERIFY_WORKSPACE_CHECKED`), since the root runs them once.

**An app's re-run triggers match only the app and the packages it consumes.** Under `--changed`, Vitest runs a whole suite when a changed file matches a trigger. Vitest matches the triggers against every file the repository's diff names. So Stream Keepr's `**/package.json` and `**/server/db/migrations/**` matched every project's files: an edit to Score Keepr's `package.json`, or a Keepr Accounts migration, ran all 532 of Stream Keepr's unit test files. Each trigger is now held to the app's own directory and to each workspace package it depends on, through `dependencies` or `devDependencies`, one through another. The lockfile is a trigger too (`packages/tooling/scripts/rerun-triggers.mjs`). Score Keepr and Keepr Accounts use the same triggers, with Vitest's defaults (manifests and Vitest configs), Nuxt's config, and Keepr Accounts' migrations, which its SQLite harness reads from disk.

**`pnpm verify` stays the full local reproduction of CI**, for every project.

### Why

- **The root checked too much.** A one-line Stream Keepr change ran about three CI-minutes of package tests and two Nuxt builds before its own gates (#1343).
- **One graph.** CI's scope and the local quick gate now answer "what can this change affect" in one place. A project that is added or rewired is scoped the same way in both.
- **The triggers reached the whole repository.** This was read from the config in #1343 and confirmed here. With a Keepr Accounts migration as the only change, `vitest list --changed` in Stream Keepr listed all 532 unit files. With the triggers narrowed, it listed none.
- **Packages run whole.** A package's tests take seconds to a minute, and none has a `--changed` gate. A package that wants one adds a `verify:quick` script, and the root runs that instead.

### Consequences

- Any `package.json`, the tooling's scripts, the lockfile and files in no project still affect every project (ADR-0147). From the root, a change to Score Keepr's `package.json` runs every project's quick gate. Each app's suites then run only the tests that reach the change, which for a manifest outside the app is none.
- ADR-0082's consequence still holds: a test that reads a file without importing it is not selected by a change to that file. The narrowed triggers add cases: Stream Keepr's wiring test reads the other apps' `package.json`, and a change there no longer re-runs it. CI catches these.
- Run slots are unchanged. Each heavy gate takes its own slots (`keepr-slots`, or the Vitest plugin in Stream Keepr), and the root's runner takes none.
- The apps' `verify:quick` scripts measure from `origin/main`, as Stream Keepr's `test:changed` does. A checkout without it has to fetch.

### Rejected alternatives

- **pnpm's `--filter "...[<base>]"`.** It selects the changed projects and their dependents. With `--test-pattern` a change only to test files selects no dependents, as ADR-0147's rule does. Elsewhere it disagrees with CI's graph: a manifest, a tooling script or a file in no project, such as the lockfile, does not select every project, and a package's test helpers that dependents import would count as tests. Two graphs would drift.
- **Run every affected project's gates side by side.** The run slots already bound what runs at once, and the heavy gates (Stream Keepr's typecheck and suites) already run in parallel inside their app's runner. A failure is easier to read in sequence.
- **Leave Score Keepr's and Keepr Accounts' triggers as Vitest's defaults.** Those match every project's manifests and Vitest configs, but not the lockfile, so a dependency bump would run none of their tests.
