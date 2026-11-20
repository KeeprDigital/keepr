# ADR-0147: CI runs a gate only for a change that affects a project it checks

Accepted · 2026-11-20 · [#1367](https://github.com/KeeprDigital/keepr/issues/1367), part of [#1343](https://github.com/KeeprDigital/keepr/issues/1343) · Amends ADR-0082 and ADR-0123 · Amended by ADR-0149: CI's jobs are grouped by project, so the Lint job is the Workspace checks and the Packages job is three, Engines, Shared app code and Tooling

### Decision

**CI skips a gate when no workspace project it checks is affected by the change.** ADR-0082 kept CI the full gate, with nothing it runs narrowed. Now the scope job (`packages/tooling/scripts/ci-scope.mjs`) also outputs `gates`, the project gates to run, and each of those jobs runs only when it is listed. The Lint job checks the whole workspace and still runs for every change to the code. The Worker legs stay as ADR-0121 decided.

**A change affects the projects whose files it changes, and every project that depends on them, one through another.** The graph is read from the projects' own `package.json` files: a project depends on each workspace package it names in `dependencies` or `devDependencies`. The first is what its build and code import, the second what its tests import. `packages/tooling/scripts/project-graph.mjs` holds this, and nothing hard-codes the table in #1343. It answers by project name, so a later slice can reuse it for a change-aware local `verify:quick` (#1369). It also applies these rules:

- **A file no dependent can import affects only its own project.** That is a test file (`*.test.ts`). It is also any file under a package's `test/` when the package's `exports` name nothing there, as with the tooling and the engines. The shared layer declares no `exports`, and its dependents import its test helpers, so those reach them.
- **A manifest affects every project.** It can change the graph itself, and other projects read it without importing it: the tooling reads every manifest, and Stream Keepr's wiring test reads each app's scripts.
- **A deploy descriptor or a Wrangler configuration also affects the tooling.** The deploy tooling's tests read the workspace's real ones.
- **The tooling's scripts affect every project.** They run the apps' heavy gates (`keepr-slots`) and deploys, and CI's own scope and reuse decisions.
- **A file in no project affects every project.** Nothing says what reads it. Among these files are the lockfile, `pnpm-workspace.yaml`, the root `package.json`, `tsconfig.base.json`, the lint and format configuration, `ci.yml` and its setup action.
- **Anything the scope cannot tell still runs everything.** That covers an empty or failed diff, an event it cannot measure, and a checkout with no workspace to place the change in.

**Which projects each gate checks is a table in the scope, held to `ci.yml`.** `PROJECT_GATES` lists each project gate's job id, the name GitHub reports when the job is skipped, and the projects it checks, matched by directory. `ciWorkflows.test.ts` holds each entry to its job's name and condition. It also checks the projects against where the job runs: an app's directory, or the root's scripts that run every package. Today's jobs keep their names and grouping. Stream Keepr's five check `apps/stream`, `Packages` checks every package, `Score Keepr` checks `apps/score`, and `Keepr Accounts` checks `apps/accounts`.

**The documentation test runs in the Lint job when its suite does not.** It is among the tests of Stream Keepr's Unit suite. A change to a document that skips that suite runs `pnpm verify:docs` in the Lint job, as a docs-only change already did.

**A merge group reuses a PR run with skipped jobs only when the group's own run would skip each of them too.** This generalises ADR-0123. The scope measures the group first. It then gives the reuse check (`ci-reuse.mjs`) the names of the jobs the group's run would skip: each project gate it does not run, and the Worker job when it runs no leg. Every job of the PR run must have passed, except one skipped under exactly one of those names. A matrix job that its condition skips is reported under its name's template, unexpanded, so the scope names it that way, for example `Integration suite (${{ matrix.shard }}/2)`. A single leg or shard that was skipped carries an expanded name, so it is never accepted. A PR run that ran more than the group would is accepted, since it left nothing out. `NO_LEG_WORKER_JOB` moves from `ci-reuse.mjs` to `ci-scope.mjs`, beside the other names.

### Why

- **"Everything" outgrew one app.** ADR-0082 was decided when CI checked one app. Since the workspace (ADR-0091) it is about 27 runner-minutes over a dozen jobs, and about 62% of that is Stream Keepr's suites, which a change to the engines or to Keepr Accounts cannot affect (#1343 has the measurements). A Score Keepr or engine-only change now needs Lint, Packages and Score Keepr, about 4 to 5 runner-minutes and 2 minutes of wall time instead of 5.
- **The safety argument is the one ADR-0036, ADR-0121 and ADR-0123 already accept.** A skipped gate is safe when what it checks is unchanged from a revision that passed it. The change is measured against the revision it lands on, and in the queue that is the queue's base. A gate whose projects and their dependencies are untouched checks exactly the code the base already passed.
- **Dependencies and devDependencies alike.** A dependent's tests import what it devDepends on. For example, Stream Keepr's integration suite runs against the Accounts Stand-in, so a change to the stand-in runs Stream Keepr's gates. #1343's table had the stand-in affecting only itself.
- **The graph reads the manifests, and a test of the real workspace holds the result.** A project added or rewired is scoped correctly with no edit here. `ciScope.test.ts` checks that a Pairing Engine change in this workspace runs only Packages and Score Keepr.
- **Without extended reuse, narrowing would cost a second full run.** ADR-0123 accepted one skipped job. Every narrowed PR run skips several, so without this change its merge group would run CI in full on the identical tree.
- **The reuse check compares names with the group's own scope, never with the PR run's.** As in ADR-0123, the two scopes can measure against different bases. Only the group's own scope says what its run would skip, and it is measured as ever.

### Consequences

- A `packages/pairing`-only change runs Lint, Packages and Score Keepr. Stream Keepr's jobs and Keepr Accounts are skipped, and no Worker leg runs. A change to the lockfile, a tooling script, `ci.yml` or its setup runs every job. So does the PR that lands this.
- Some of #1343's claims were corrected while this was built:
  - **Only Stream Keepr's Vitest configuration imports `slots.mjs`.** Score Keepr and Keepr Accounts reach the tooling through `keepr-slots` in their scripts, and no package uses it. The tooling's scripts still affect everything, for the reasons above.
  - **There are reach-ins between projects that no manifest declares.** They are file reads, not imports. Stream Keepr's `repoWiring.test.ts` reads the other apps' `package.json`, and the tooling's deploy tests read the apps' deploy descriptors, their Wrangler configurations and the stand-in's. The manifest and the descriptor-or-Wrangler rules cover them. A new read of another project's file needs a rule here or a declared dependency.
- The stand-in affects Stream Keepr because Stream Keepr devDepends on it, as above.
- A gate a change does not affect is checked only at the queue's base. That is sound while nothing bypasses the queue, as ADR-0036 already relied on for docs-only changes.
- The local `verify:quick` is unchanged here. #1369 makes it change-aware with `affectedProjects`, and #1368 regroups CI's jobs by project, editing `PROJECT_GATES` with `ci.yml`.
- No repository setting or required check changes. `CI passed` still waits on every job and treats a skipped job as passed.
- Unit-tested without GitHub. The graph and the gates are tested at their home (`ciScope.test.ts`, a row per branch, plus one row on the real workspace). The accepted and refused skips are in `ciReuse.test.ts`, and the gate table's wiring in `ciWorkflows.test.ts`. Only a queued merge of a narrowed PR shows that GitHub reports a skipped static matrix by its template. That is already seen in PR runs of docs-only changes, for example run 44664239951.

### Rejected alternatives

- **Hard-code #1343's dependency table in the scope.** It would be wrong as soon as a project gained a dependency, and nothing would fail.
- **Let a project's whole `test/` directory affect only that project.** Dependents import the shared layer's test helpers, so a change to one would skip the apps that use it.
- **Put the projects each gate checks in `ci.yml`'s conditions,** with the scope outputting only projects. The reuse check would then need to know, without a YAML parser, which jobs a scope skips. The CI scripts import only Node (`packages/tooling/README.md`).
- **Accept a skipped job when the PR run's own scope skipped it.** The group measures against the queue's base, which the PR run never saw (ADR-0123).
- **Require a PR run's skipped jobs to equal the group's exactly.** A PR run that ran a gate the group would skip left nothing out, and refusing it would cost a full run for nothing.
