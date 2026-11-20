# @keepr/tooling

The workspace's own tooling (ADR-0110, in the root `docs/adr`): what every app, the root and CI run, kept apart from any one app.

| Script | Run as | What it does |
|---|---|---|
| `scripts/slots.mjs` | `keepr-slots`, `pnpm slots` | Run slots: one budget of heavy work for the machine, shared by every worktree (ADR-0082). `keepr-slots <cost> -- <command>` runs a command inside them. |
| `scripts/reap-workerd.mjs` | `keepr-reap-workerd`, `pnpm reap` | Stops orphaned `workerd` from any checkout of this repository. |
| `scripts/deploy/cli.mjs` | `keepr-deploy`, `pnpm run deploy --app <app> --env <env>`, an app's `deploy:*` scripts, `deploy-build.yml` (`build --artifact`), `deploy-installation.yml` (`deploy --artifact`, `gates`), CI's `worker-guard` legs (`check`) | The deploy procedure (ADR-0119): one Release of one app to one Environment, from its deploy descriptor (`deploy/release.mjs`): build once, beside the Accounts Stand-in when the app's source configuration binds Keepr Accounts (`deploy/build.mjs`, ADR-0141 in `apps/stream/docs/adr`), or place an artifact, parts by fingerprint (`deploy/fingerprint.mjs`), deploy order between Keepr Accounts and its Apps (`deploy/order.mjs`, ADR-0120) and each D1 database's Time Travel bookmark (`deploy/recovery.mjs`, ADR-0125) before the first remote change, D1, Worker, verify of the release identity (`deploy/verify.mjs`), each between its promotion markers (`deploy/markers.mjs`, `deploy/procedure.mjs`). `gates` runs the descriptor's acceptance gates against an Installation (ADR-0129). `check` is CI's Worker leg: each part bundled, then the build. |
| `scripts/deploy/plan.mjs` | `deploy.yml`'s `plan` job | What a Deploy run deploys: each app it names resolved to a published Release, Keepr Accounts apart so its jobs run before the Apps' (ADR-0120), and the Environments: one, or staging then production (ADR-0125). An override is refused for a run of more than one app. Its summary lists what to confirm before approving production. |
| `scripts/deploy/dispatch.mjs` | `release.yml`'s `deploy` job | A Release deploys itself: the apps the release run published start one Deploy run, to staging then production (ADR-0125). |
| `scripts/secrets/cli.mjs` | `keepr-secrets-sync`, `pnpm secrets:sync --app <app> --env <env>` or `--github <environment>` | Sets an Installation's Worker secrets (`wrangler secret bulk`) or a GitHub environment's (`gh secret set`) from 1Password (`op`), as the root `secrets.jsonc` maps them (`secrets/map.mjs`), its Worker names checked against the deploy descriptor's (`secrets/sync.mjs`, ADR-0134). `--check` sets nothing; `--generate <NAME>` writes a new random value into 1Password first, and syncs it only once 1Password reads it back (ADR-0135). |
| `scripts/deploy-guard.mjs` | `keepr-deploy-guard <wrangler config>`, and every deploy | Refuses a Worker whose `package.json` carries `keepr.undeployable`: the Accounts Stand-in (ADR-0113). Reading a Release runs it on every configuration its descriptor names, and a deploy again on what the build or a placed artifact left to upload, before the first remote change. |
| `scripts/jsonc.mjs` | imported | JSON with comments, as Wrangler configs and deploy descriptors are written. |
| `scripts/change-base.mjs` | imported | Where a branch's change is measured from: `origin/main`, else `main`. |
| `scripts/ci-scope.mjs`, `scripts/ci-reuse.mjs` | CI's `scope` and `record` jobs | What a change can affect: which project gates it runs (`PROJECT_GATES`, grouped by project, ADR-0147, ADR-0149), which deployable apps' Worker legs, and whether a merge group's tree was already verified by a PR run that skipped only what the group skips (ADR-0036, ADR-0121, ADR-0123). |
| `scripts/project-graph.mjs` | imported | The workspace's projects as their `package.json` files link them, and which of them a change affects (`affectedProjects`): each it touches and every one that depends on it, by `dependencies` or `devDependencies` (ADR-0147). Also what one project depends on (`dependenciesOf`). |
| `scripts/verify-quick.mjs` | `pnpm verify:quick` at the root | The changeset check, the quick gates of each project the change affects since `main` (`affectedProjects`): a project's `verify:quick`, or else its `typecheck` and `test`, packages first, then the lint (ADR-0148). |
| `scripts/rerun-triggers.mjs` | imported by each app's Vitest config | The files that re-run an app's whole suite under `--changed`, held to the app and the packages it depends on, with the lockfile (ADR-0148). |
| `scripts/conventional-title.mjs` | `pr-title.yml` | The `Conventional Commit title` required check. |
| `scripts/changeset-check.mjs` | `keepr-changeset-check`, CI's `checks` job, `pnpm verify:quick` at the root and in Stream Keepr | A change names each versioned app whose shipped code it touches in a changeset, or carries an empty one (ADR-0118). |
| `scripts/shipped-code.mjs` | imported | An app's shipped code, which the changeset check and CI's Worker legs both read (ADR-0118). |
| `scripts/versioned-apps.mjs` | imported | The workspace's packages, and the apps Changesets versions: each in `apps/` that `.changeset/config.json` does not ignore. |
| `scripts/changelog.mjs` | `.changeset/config.json`'s `changelog`, and `pnpm release:version` after `changeset version` | Each Release's CHANGELOG section grouped as Operator steps, Features, Fixes and Other changes, by each changeset's bump, each entry labelled from its PR's Conventional Commit title (ADR-0126, ADR-0127). |
| `scripts/release-gate.mjs` | `pnpm release:publish`, in `release.yml` | Refuses to tag a Release on a commit the merge queue did not verify (ADR-0036, ADR-0118). |

## Rules

- **A script imports only Node.** CI runs the CI scripts from a sparse checkout with no install, and `slots` and `reap-workerd` run before anything is built.
- **Nothing here knows an app.** What it learns of one, it reads from the workspace (`versioned-apps.mjs`) or from the app's deploy descriptor (`deploy/release.mjs`); the exceptions are how Stream Keepr deployed before descriptors, so a rollback to such a Release still deploys (ADR-0119), Keepr Accounts' name, service and directory, which deploy order needs (ADR-0120), the Accounts Stand-in's launcher in the Release being built, which the build of an app that binds Keepr Accounts runs beside (ADR-0141), and the projects each of CI's gates checks (`PROJECT_GATES` in `ci-scope.mjs`, held to `ci.yml` by `test/ciWorkflows.test.ts`, ADR-0147). What only one app runs (Stream Keepr's `verify.mjs`, its build checks and acceptance scripts) stays in that app. An app that strands more than `workerd` reaps it itself with `discoverCheckoutRoots` and `terminateAll` (`apps/stream/scripts/reap.mjs`).
- **A workflow names a script by its path from the repository's root**, and a job that checks out only some files lists it and every module it imports (`test/ciWorkflows.test.ts` holds both; the Deploy workflow's are in `test/deployWorkflow.test.ts`).
- **The deploy's tests never reach Cloudflare.** Cloudflare and GitHub's Deployments API, where the markers live, are faked in memory (`test/helpers/fakeGitHub.ts`, which a command-line test reaches through a `gh` on its PATH), and the suite's setup blocks Wrangler's credentials (`test/helpers/blockCloudflareCredentials.ts`).
- **The secrets sync's tests never reach 1Password, Cloudflare or GitHub.** `op`, `wrangler` and `gh` are fake executables on a `PATH` that holds nothing else (`test/helpers/secretsFakes.ts`).

## Run slots by hand

`KEEPR_RUN_SLOTS` sizes the pool (`KEEPR_RUN_SLOTS=4`), or `off` runs every gate unqueued. Its former name, `STREAM_KEEPR_RUN_SLOTS`, is still read while it is unset. The ledger keeps its file, `stream-keepr-run-slots.sqlite` in the Git common directory, so a worktree on an older revision shares the pool.

## Commands

```
pnpm typecheck   # the scripts' JSDoc types as the tests read them, and the tests
pnpm test        # the unit tests
```
