# ADR-0154: CI, Release and Deploy refuse what they cannot vouch for

Accepted · 2026-11-20 · [#1382](https://github.com/KeeprDigital/keepr/issues/1382) · Amends ADR-0082, ADR-0113, ADR-0118, ADR-0119, ADR-0120, ADR-0123, ADR-0125, ADR-0133, ADR-0134 and ADR-0135

### Decision

A review found places where CI could pass a change no gate checked, a Release could be tagged on another commit than the one that set its version, and a Deploy could migrate or promote from another build than the Release's. Each now refuses, or the gap is recorded.

**CI.**

- **A moved file is both of its paths.** The scope diffs with `--no-renames`, so the project a file left runs its gates as well as the one it joined.
- **`CI passed` fails a change to the code that neither the lint nor any gate checked.** When the scope said `code=true` and no PR run's reuse verified the tree, the Workspace checks job must have succeeded and at least one other gate too. `ciWorkflows.test.ts` runs that step's shell rather than reading it.
- **What builds every Worker leg is shipped code.** The root `package.json` (the Node and pnpm it pins) and `tsconfig.base.json` join the lockfile and `pnpm-workspace.yaml` as what every app ships (amends ADR-0118). The changeset check then asks a changeset for them, and the scope runs every leg for them as shipped code.
- **Deleting a changeset names an app only when the change moves that app's version.** That is the Version PR consuming it. Deleting another change's pending changeset names nothing.
- **The JSONC reader takes a trailing comma followed by a comment**, as Wrangler does.

**Release.**

- **The release gate refuses unless `HEAD` set the version it would tag.** `changeset git-tag` tags `HEAD`. Three cases leave `HEAD` past the Version PR's commit: the Version PR merged in one queue push with a PR behind it, a release run superseded while pending, and a manual retry after `main` moved. The gate names the commit that set the version, and a maintainer tags it by hand. That commit passed its own merge-group run, since each queue entry passes on its own.
- **The pinned `changesets/action` (v2.1.2) neither opens a Version PR nor publishes while only empty changesets wait.** Its source says `All changesets are empty. Not creating PR` and returns before the publish branch. A Version PR merged with an empty changeset left beside it is therefore not tagged by the workflow. It is tagged by hand before the next Version PR consumes the empty changeset.

**Deploy.**

- **Keepr Accounts' production job waits for every App's staging job** when the run has Apps, as ADR-0125 said. Before, it waited only for its own staging. `deployWorkflow.test.ts` plays the job graph out with GitHub's rules, so "an App's staging failed, so nothing reaches production" is the assertion, not the `needs` list.
- **Deploy order compares over everything Keepr Accounts ships**: its directory and each package its `dependencies` reach, without tests, docs and Markdown (amends ADR-0120). Before, only `apps/accounts` counted.
- **A build records where it came from, and a deploy refuses another.** The tooling's build writes `keepr-build.json` into the output: the commit it was built from, and each of the descriptor's `testFlags` that was set (Stream Keepr's `STREAM_KEEPR_INTEGRATION`). Before its first remote change, a deploy refuses a build with no record, a record of another commit, or any test-only flag set. `check --env`, `status` and `mark-app`, which read the built configuration, refuse one built from another commit.
- **The D1 recovery point is read again immediately before the migration** (amends ADR-0125). It is still read before the first remote change, where a missing one refuses the deploy. The point the app's marker records, and a restore returns to, is the one read after the parts deployed.
- **`KEEPR_DEPLOY_URL` is `verify`'s alone.** A deploy verifies the Environment's URL, the Installation it deployed.
- **A production deploy is of a Release** (amends ADR-0119). A dirty checkout, or a `HEAD` that is not the app's `@keepr/<app>@<version>` tag, needs `--unreleased <reason>`, which the app's marker records, as `--override` does for deploy order.
- **The staging gates have their own step timeout**, and so does the deploy, inside a job timeout that outlasts both. A slow gate spends only its own budget.
- **The Worker dry run bundles every Environment the descriptor names**, each with its own Wrangler env, into `.wrangler/dry-run/<environment>`, outside the output a deploy uploads (`deploy/dry-run.mjs`).
- **The Accounts Stand-in fails closed** (amends ADR-0113). Its Worker refuses every request unless `keepr-accounts-stand-in` started it with `--var KEEPR_ACCOUNTS_STAND_IN:launched`. Its configuration names an account no one holds (all zeros), so a bare `wrangler deploy` of it has nowhere to go unless `CLOUDFLARE_ACCOUNT_ID` overrides it; the Worker's refusal holds either way.

**Run slots** (amends ADR-0082).

- **A holder keeps its slots for as long as its process lives.** The 30-minute limit is gone, because it dropped a long run that was still working.
- **A waiter records when it last asked, and one silent for a minute leaves the line.** Its pid may answer for another process after it died, so a living pid is not enough to keep its place.

**Secrets.**

- **`--generate` confirms the destination answers before writing 1Password.** When the destination fails after the new value was written, the error names `pnpm secrets:sync --app <app> --env <env>`, which finishes the sync.
- **The redactor also scrubs each value as JSON escapes it**, which is how a tool that echoes the JSON it was given prints a multi-line value.
- **A PEM with only some of its line breaks lost is refused**, as one with none already was.

**Recorded, not changed.**

- **CI's `record` job mints an OIDC token from a PR branch's own script** (amends ADR-0123). The job runs `ci-reuse.mjs` as the PR's branch has it, with `id-token: write`, so a PR can mint a token GitHub signs for this repository. Nothing trusts its claims beyond the commit it names. No cloud role may trust this repository's tokens without a condition on the ref or the workflow's event.
- **Any workflow granted `deployments: write` can write a promotion marker** (amends ADR-0133). The markers are GitHub Deployments, and GitHub scopes that permission to the repository, not to an environment. A workflow that holds it can mark any Installation `deployed`. Granting it is a decision about the markers, and only the Deploy workflow's deploying jobs hold it.

### Why

- **Each gap let a check pass on something it had not checked.** A rename hid a project, an all-skipped run passed, a later commit took a tag, another build was deployed, or a test build reached an Installation. Refusing costs a person one step: a flag with a reason, a hand-made tag, or a rebuild. Passing costs a wrong Release.
- **Tests hold behaviour, not text.** `CI passed`'s shell is run, and the Deploy job graph is played out. A reordering of `needs` or a rewritten condition is then caught by what it does.
- **The built-config note was re-measured.** `apps/stream/README.md` § Worker secrets had recorded that the built configuration's `--env staging` reached Production. On a fresh build of this checkout, Wrangler's own reader resolves it to the Staging account, as `wrangler.jsonc` does. The first reading most likely came from a build another commit made, and the build record now refuses that. Commands handed to a person still go through `wrangler.jsonc`, which needs no build.

### Consequences

- A production deploy from a checkout that is not exactly a Release now needs `--unreleased`. The Deploy workflow checks out the Release's tag, so it passes.
- A deploy of an artifact built by tooling older than this has no build record, and is refused. Every Release builds its artifact in the run that deploys it, so only a local `--artifact` from an old build meets this.
- If the second bookmark read fails, the parts may already be deployed while the app is not, with their markers saying so; the app's marker is untouched, and a redeploy finishes it.
- A build records `HEAD`, dirty or not; a dirty checkout is caught when it deploys to production, by `--unreleased`.
- A long suite no longer loses its slots at 30 minutes. A truly hung one holds them until its process is stopped (`pnpm slots` names it).
- A waiter from a worktree on an older revision writes no `seen`. It is dropped after a minute and re-queues behind those waiting. It keeps waiting, but loses its place.
