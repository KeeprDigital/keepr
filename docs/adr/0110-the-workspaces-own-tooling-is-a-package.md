# ADR-0110: The workspace's own tooling is a package

Accepted · 2026-11-17 · Amended by ADR-0119: the deploy procedure is the package's (`keepr-deploy`), for every app and Environment, and an app keeps only its deploy descriptor and thin scripts

### Decision

**What the root, every app and CI run is `packages/tooling` (`@keepr/tooling`).** It holds the run slots, the change base, the `workerd` reaper, CI's scope and reuse scripts, the Conventional Commit title check and the release gate, each moved from `apps/stream/scripts` keeping its file name.

**An app and the root run them as the package's commands**, `keepr-slots` and `keepr-reap-workerd`, naming `@keepr/tooling` as a dev dependency. A workflow runs a CI script by its path, `node packages/tooling/scripts/<name>.mjs`.

**An app's own tooling stays in the app.** Stream Keepr's `verify.mjs`, deploy, preview and acceptance scripts are about its Worker. Stream Keepr's `pnpm reap` reaps its leaked acceptance Chrome itself (`apps/stream/scripts/reap.mjs`), after the package's `workerd` reap, with the package's checkout discovery and termination.

### Why

- **Score Keepr and the root ran Stream Keepr's scripts.** The root's lint and Score Keepr's build and typecheck named `apps/stream/scripts/slots.mjs`, and CI's required checks ran from Stream Keepr's directory. What every app depends on lived in one of them.
- **A package has a typecheck, tests and a CI job already.** `pnpm typecheck:packages` and `pnpm test:packages` run it, in CI's Packages job. A root `scripts/` folder would have needed a test configuration, a root test script and a job of its own.

### Consequences

- ADR-0036 (the merge queue) and ADR-0082 (run slots and quick verification) move to the root `docs/adr` with the code they govern (ADR-0095), changing only in the paths they name.
- The run-slot ledger keeps its file and its tables, so a worktree still on the earlier layout and one on this share one pool.
- A gate names its checkout by the directory it runs from: the root, or an app or package below it.
- `pnpm slots` and `pnpm reap` also run at the root; the root's reap stops only `workerd`.
- A script imports only Node, so CI's sparse checkouts, which install nothing, can run it.
- The tooling's tests run in the Packages job instead of Stream Keepr's unit suite. Stream Keepr keeps the tests of its wiring: its gates' slot costs, its Vitest runs held to their slots, and its Chrome reap.

### Rejected alternatives

- **A root `scripts/` folder.** The root would have held the files as ADR-0095 describes, but the tests would have had no home.
- **Each app keeping its own copy.** Two run-slot pools would not see each other, which is the problem run slots exist to solve.
