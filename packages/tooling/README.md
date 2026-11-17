# @keepr/tooling

The workspace's own tooling (ADR-0110, in the root `docs/adr`): what every app, the root and CI run, kept apart from any one app.

| Script | Run as | What it does |
|---|---|---|
| `scripts/slots.mjs` | `keepr-slots`, `pnpm slots` | Run slots: one budget of heavy work for the machine, shared by every worktree (ADR-0082). `keepr-slots <cost> -- <command>` runs a command inside them. |
| `scripts/reap-workerd.mjs` | `keepr-reap-workerd`, `pnpm reap` | Stops orphaned `workerd` from any checkout of this repository. |
| `scripts/change-base.mjs` | imported | Where a branch's change is measured from: `origin/main`, else `main`. |
| `scripts/ci-scope.mjs`, `scripts/ci-reuse.mjs` | CI's `scope` and `record` jobs | What a change can affect, and whether a merge group's tree was already verified (ADR-0036). |
| `scripts/conventional-title.mjs` | `pr-title.yml` | The `Conventional Commit title` required check. |
| `scripts/release-gate.mjs` | `release-please.yml` | Refuses a release the merge queue did not verify (ADR-0036). |

## Rules

- **A script imports only Node.** CI runs the CI scripts from a sparse checkout with no install, and `slots` and `reap-workerd` run before anything is built.
- **Nothing here knows an app.** What only one app runs (Stream Keepr's `verify.mjs`, its deploy and acceptance scripts) stays in that app. An app that strands more than `workerd` reaps it itself with `discoverCheckoutRoots` and `terminateAll` (`apps/stream/scripts/reap.mjs`).
- **A workflow names a script by its path from the repository's root**, and a job that checks out only some files lists it (`test/ciWorkflows.test.ts` holds both).

## Run slots by hand

`KEEPR_RUN_SLOTS` sizes the pool (`KEEPR_RUN_SLOTS=4`), or `off` runs every gate unqueued. Its former name, `STREAM_KEEPR_RUN_SLOTS`, is still read while it is unset. The ledger keeps its file, `stream-keepr-run-slots.sqlite` in the Git common directory, so a worktree on an older revision shares the pool.

## Commands

```
pnpm typecheck   # the scripts' JSDoc types as the tests read them, and the tests
pnpm test        # the unit tests
```
