# ADR-0124: The release GitHub App pushes the Version PR, the Release tags and the promotion markers

Accepted · 2026-11-18 · [#1261](https://github.com/KeeprDigital/keepr/issues/1261), part of [#1258](https://github.com/KeeprDigital/keepr/issues/1258) · Amends ADR-0035, ADR-0036, ADR-0118 and ADR-0122

### Decision

**One GitHub App writes for the Release and Deploy workflows: the release GitHub App.** It is installed on this repository only, with Contents, Pull requests and Workflows read and write, and Metadata read. Each job that writes mints a token of it (`actions/create-github-app-token`, pinned by SHA), narrowed to the permissions that job needs, and the token is revoked when the job ends.

- **Release** (`.github/workflows/release.yml`): `changesets/action` opens and updates the Version PR, pushes the Release tags and makes the GitHub Releases with a token narrowed to Contents, Pull requests and Workflows. The release gate keeps reading the merge-group CI runs with `GITHUB_TOKEN` (`actions: read`), which `gh` reads as `GH_TOKEN`: the App has no Actions permission.
- **Deploy** (`.github/workflows/deploy-installation.yml`): the Release checkout persists a token narrowed to Contents and Workflows, and the deploy pushes the app's promotion markers, and removes the tags they replace, through it.

**`GITHUB_TOKEN` writes nothing in either workflow.** It checks out, resolves the Releases and reads the merge-group runs. The repository setting that lets Actions create pull requests is no longer needed.

**The App's ID and private key are environment secrets, never repository secrets:** `KEEPR_RELEASE_APP_ID` and `KEEPR_RELEASE_APP_PRIVATE_KEY`. The release workflow's job runs in a GitHub environment of its own, `release`. Each Deploy job reads them from its Environment's GitHub environment (`production`, later `staging`), which Deploy's caller passes by name with the Cloudflare credentials (ADR-0122). Each of these environments deploys only from `main`. In a job, only the token step reads them.

### Why

- **`GITHUB_TOKEN` can never hold `workflows`.** GitHub refuses a GitHub App without it, `GITHUB_TOKEN`'s included, a push that would "create or update" a workflow file, and creating a ref at a commit whose workflows differ from `main`'s counts. A marker tag points at a Release, so any deploy of a Release older than a workflow change on `main`, and any rollback across one, was refused: Deploy run 44208784978 could not create `stream/production` at `e2a83d58` once #1273 had changed `deploy-installation.yml`. The Version PR's branch is reset onto `main` on every refresh, and hits the same refusal whenever `main`'s workflows have changed since.
- **A pull request opened with `GITHUB_TOKEN` starts no workflow.** GitHub creates its `pull_request` runs as `action_required`, so a maintainer had to select "Approve workflows to run" on every Version PR, and again after every push to `main` rewrote it (#1261). A pull request the App opens starts its runs like anyone's.
- **An environment, not the repository, holds the key.** A repository secret is readable by any workflow on any branch that asks for it. An environment deploying only from `main` gives it only to the jobs that name that environment, from a workflow on `main`.
- **One App, narrowed per job,** rather than one App per workflow: the narrowing gives each job no more than a second App would, with one key to rotate.

### Consequences

- A human creates the App, installs it on this repository, and adds both secrets to `release` and to `production` (and to `staging` when it exists). Until then the Release workflow fails at its token step, and so does every Deploy job. No Deploy can mark a Release before then, whatever its workflows.
- The Version PR no longer needs a maintainer's approval to run CI (`apps/stream/README.md` § Releases). It still lands alone.
- The Version PR, its commits and the GitHub Releases are the App's. The marker tags keep `github-actions[bot]` as their tagger: that is the annotated tag's recorded identity, not the pusher.
- The deploy job installs a Release's dependencies in the checkout that holds the App's token, as it held `GITHUB_TOKEN` before. That token can now write workflows, so a malicious install script in a Release could push one; it lives at most the job's 30 minutes and is revoked when the job ends.
- The workflow wiring is tested where it is read (`packages/tooling/test/deployWorkflow.test.ts`, `ciWorkflows.test.ts`). Only a real Deploy run and a real Version PR prove the App's permissions against GitHub.

### Rejected alternatives

- **A personal access token.** It acts as a person, outlives their access and is rotated by hand; the App's tokens are short-lived and the App survives anyone leaving.
- **Pushing markers with `GITHUB_TOKEN` and protecting nothing else.** It cannot hold `workflows`; no permission the workflow declares changes that.
- **Skipping the marker push when GitHub refuses it.** The marker is what ADR-0035's deploy decisions rest on; a deploy whose pending marker cannot be written must not start.
- **The App's secrets as repository secrets** (#1261 as first written). Any workflow, on any branch, could read them.
