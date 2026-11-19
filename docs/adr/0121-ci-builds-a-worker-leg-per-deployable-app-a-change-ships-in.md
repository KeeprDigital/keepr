# ADR-0121: CI builds a Worker leg per deployable app a change ships in

Accepted · 2026-11-17 · [#1265](https://github.com/KeeprDigital/keepr/issues/1265), part of [#1258](https://github.com/KeeprDigital/keepr/issues/1258) · Amends ADR-0036 · Amended by ADR-0123: a PR run with no Worker leg records its tree, and a merge group with no leg of its own reuses it · Amended by ADR-0141 (in `apps/stream/docs/adr`): the deploy tooling's build step starts the stand-in for an app that binds Keepr Accounts, in a deploy's build as in CI's leg

### Decision

**CI's Worker check is a matrix with one leg per deployable app the change ships in.** A deployable app is one with a deploy descriptor (ADR-0119). A change ships in an app when it touches the app's shipped code, as ADR-0118 defines it (`packages/tooling/scripts/shipped-code.mjs`). The scope job (`packages/tooling/scripts/ci-scope.mjs`) answers the legs as its `apps` output, and each leg runs `keepr-deploy check --app <app>`: every part bundled, then the descriptor's build, which is the build, the wrangler dry run and the Worker smoke a deploy runs.

**An untouched app has no leg, not a skipped one.** The matrix holds only the apps the change ships in. When it holds none, the job does not run.

**Some changes run every leg, though no app ships them** (`BUILDS_EVERY_LEG`): CI's own workflow (`ci.yml`), its setup action (`.github/actions/setup/`), the tooling's scripts that a leg runs and the tooling's manifest that names them, the root `package.json`, which pins Node and pnpm, and `tsconfig.base.json`. The tooling's tests and documents run no leg, and neither do the other workflows. When the scope cannot tell what changed, every leg runs.

**An app that binds Keepr Accounts runs its leg against the Accounts Stand-in.** That is an app whose source Wrangler configuration (its descriptor's `worker.source`) binds the `keepr-accounts` service in any block, top level or any Environment's. A change to the stand-in, or to anything it ships, runs that app's leg too. The stand-in is never deployed (ADR-0113).

**A merge group may reuse a PR run whose matrix left apps out.** ADR-0036 reuses "a full, green PR run": a run in which every job ran and passed and none was skipped by its scope. An app with no leg is not a skipped job, so a PR run with legs for only the apps it touches can still be that run. The group reuses it only for a byte-identical tree, so the same change against the same base gives the same legs.

### Why

- **The deploy unit is the app** (ADR-0119). With more than one deployable app, building every app's Worker for every change costs a full build per app. Building an app that the change does not ship in proves nothing new: that app's shipped code is the base's, which passed its own run.
- **No leg rather than a skipped leg.** ADR-0036 trusts a PR run for reuse only when no job was skipped by its scope. A leg skipped for an untouched app would make every PR that touches one app unreusable, and the queue would run CI twice on the same tree again.
- **What builds every leg, and only that.** A change to the workflow, to the setup, to the scripts a leg runs or to the toolchain it pins can break any app's build. A change to the tooling's tests is checked by the tooling's own test job, and its documents by the documentation test, so neither needs a Worker build.
- **The stand-in in CI, never in a deploy.** A Worker smoke of an app that binds Keepr Accounts needs something answering as Keepr Accounts, and CI has no Keepr Accounts to call. A change to the stand-in can break that smoke, so it runs the leg.

### Consequences

- A new deployable app joins the matrix by gaining a deploy descriptor; no workflow edit names it.
- A PR run that touches no deployable app's shipped code runs no leg and leaves no reuse record, so its merge group runs in full, as for a tests-only change before.
- The scope reads the Worker's source configuration the descriptor names (`worker.source`), not its `worker.config`: that is the built Worker's configuration, and the scope runs before anything is built. Deploy order reads the built configuration for one Environment (ADR-0120); both use one definition of what binding Keepr Accounts is (`servicesBindKeeprAccounts` in `deploy/order.mjs`).
- `pnpm validator:dry-run` is no longer its own CI step: the leg bundles the validator as a descriptor part.
- Unit-tested without GitHub: the legs at their home (`packages/tooling/test/ciScope.test.ts`) and the matrix's wiring (`ciWorkflows.test.ts`).

### Rejected alternatives

- **One Worker job that builds every deployable app.** Simple, and every change pays for every app's build.
- **A fixed job per app, skipped by its scope when untouched.** A workflow edit for each new app, and a skipped job blocks reuse (ADR-0036).
- **Every change under `packages/tooling/` runs every leg.** Most such changes are its tests, which no leg runs.
