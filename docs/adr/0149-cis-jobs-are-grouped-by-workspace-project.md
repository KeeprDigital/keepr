# ADR-0149: CI's jobs are grouped by workspace project

Accepted · 2026-11-20 · [#1368](https://github.com/KeeprDigital/keepr/issues/1368), part of [#1343](https://github.com/KeeprDigital/keepr/issues/1343) · Amends ADR-0147

### Decision

**CI's gates are grouped by the workspace project each checks, the axis the scope cuts on (ADR-0147).** Each job is named for its project, and `PROJECT_GATES` in `packages/tooling/scripts/ci-scope.mjs` lists each one's id, name and the projects it checks:

| Job | Name | Checks |
| --- | --- | --- |
| `checks` | Workspace checks | the whole workspace, at its root: changesets, lint, actionlint, zizmor, and the documentation test when its suite does not run |
| `stream-typecheck`, `stream-unit`, `stream-nuxt`, `stream-integration`, `stream-browser` | Stream Keepr: Typecheck, Unit suite, Nuxt suite, Integration suite (1/2, 2/2), Browser gates | `apps/stream` |
| `score` | Score Keepr | `apps/score` |
| `accounts` | Keepr Accounts | `apps/accounts` |
| `engines` | Packages: Engines | `engine-core`, `pairing`, `standings`, `testkit`, `engine-integration`, with the Pairing Engine's speed targets |
| `shared-app-code` | Packages: Shared app code | `nuxt-layer`, `realtime`, `accounts-stand-in` |
| `tooling` | Packages: Tooling | `tooling` |

**Stream Keepr's gates stay split by kind (ADR-0082).** They are the heavy suites, and the Nuxt suite still sets the wall time.

**The packages are three groups, named for what consumes them.** Only Score Keepr consumes the engines. The apps consume the shared app code. The tooling is the workspace's and CI's own. Each group's job runs its typecheck and tests over exactly its packages, through a pnpm `--filter` that names them.

**Keepr Accounts is built only by its Worker leg.** Its project gate runs its typecheck and tests. Its build already runs in its `worker-guard` leg (ADR-0121), which runs for any change that ships in it.

**`CI passed` stays the one required check from this workflow.** It waits on every job, so renaming a job needs no change to the repository's settings.

### Why

- **One axis.** Before this, Stream Keepr's jobs were split by kind with unqualified names, the other apps were one job each, and one `Packages` job ran all nine packages one after another. The scope already decides by project, so a job per project makes each skip read as the project it spares.
- **A change to one package group spares the others.** A Pairing Engine change now runs the Workspace checks, Engines and Score Keepr. Before, it also ran the shared app code's and the tooling's tests in `Packages`. A tooling test change runs only Tooling.
- **Accounts was built twice.** Its job and its Worker leg both ran `pnpm build` on the same tree. The leg's build is the one a deploy makes, so it is the one kept.
- **The workspace checks belong at the root.** The lint is one run over the workspace (ADR-0089), so running it from `apps/stream` was only a leftover of one app.

### Consequences

- ADR-0147's job names and its "Lint" and "Packages" jobs are now these. Its rules for which projects a change affects, and for merge-group reuse, are unchanged. The reuse check knows the regrouped jobs by their new names, including the matrix template `Stream Keepr: Integration suite (${{ matrix.shard }}/2)`.
- A new package must match a group's pattern in `PROJECT_GATES`. `ciWorkflows.test.ts` fails when a project of the workspace is checked by no gate, or when a root job's filter names other packages than the gate checks.
- When the Accounts gate runs without its Worker leg, for a change that ships nothing in it (its tests alone, or another project's manifest), nothing builds it. Nothing it ships changed, so the build its base passed still stands.
- A PR open while this lands may report the old job names until it is rebased. `CI passed` judges either set.

### Rejected alternatives

- **One job per package.** Nine small jobs each spend about 30 s on setup and install. Three groups keep the skip useful for the cost.
- **One job per app, Stream Keepr's suites in it.** It would put the sum of Stream Keepr's suites, not the longest one, back on the wall time.
- **Add root scripts per package group.** The filter in each job is enough, and it is held to `PROJECT_GATES` by the workflow test.
