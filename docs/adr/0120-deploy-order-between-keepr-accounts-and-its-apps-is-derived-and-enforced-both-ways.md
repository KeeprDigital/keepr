# ADR-0120: Deploy order between Keepr Accounts and its Apps is derived and enforced both ways

Accepted · 2026-11-17 · [#1263](https://github.com/KeeprDigital/keepr/issues/1263), part of [#1258](https://github.com/KeeprDigital/keepr/issues/1258) · Amends ADR-0119

### Decision

**Who depends on Keepr Accounts is derived from the built Worker.** An App depends on Keepr Accounts in an Environment when the Worker configuration its descriptor names (`worker.config`), as that Environment deploys it, binds the `keepr-accounts` service. A service binding is not inherited into a Wrangler `env` block, so an Environment deployed from one reads that block's bindings alone. Nothing is declared separately.

**"At least as new" is measured in commits, not versions.** Keepr Accounts' changes are the commits that change `apps/accounts`. An Installation is at least as new as another's view of Keepr Accounts when its commit contains every such commit the other's contains, read from the repository's full history (`git log <theirs> ^<ours> -- apps/accounts` is empty).

**Both deploys are checked before the first remote change** (the procedure's `beforeRemoteChange`, `packages/tooling/scripts/deploy/order.mjs`), in the Deploy workflow and in local `pnpm run deploy` alike:

- **An App waits for Keepr Accounts.** Its deploy to E refuses unless `accounts/E` records a confirmed (`deployed`) deploy whose commit contains every Keepr Accounts change the App's Release commit contains.
- **Keepr Accounts cannot fall below its Apps.** Its deploy to E refuses a commit that lacks a Keepr Accounts change contained in the commit of any Installation in E that depends on it, whether that Installation's marker reads `deployed` or `pending`.

**An Installation's dependency is recorded in its app marker**, as `needs: accounts`, appended after the fields ADR-0119 lists. Keepr Accounts' deploy reads every `<app>/E` marker on the remote and checks those that carry it. `mark-app` records it too, from the checkout's built Worker, so a marker written by hand does not hide a dependent.

**An override with a written reason bypasses either refusal**: `--override <reason>` to `keepr-deploy deploy`, one line of text. The deploy logs each refusal it bypassed, and the app marker records `override: <reason>`, pending and deployed. An override that bypassed nothing is not recorded.

**In the Deploy workflow, every App's job waits for Keepr Accounts' job**, not only the jobs of Apps that bind it. When a run names Keepr Accounts, its job runs first, and each App's job runs only once it has succeeded or was not part of the run. A failed Keepr Accounts deploy therefore stops every App in that run.

**A run with an override names exactly one app.** The plan refuses an override in a run that names more than one; the operator dispatches the app it is for alone.

### Why

- **Keepr Accounts is every App's sign-in** (ADR-0112). An App deployed ahead of the Keepr Accounts it was built against, or Keepr Accounts rolled back beneath an App, breaks sign-in for that App's Users, and nothing about either deploy would say so until a User tried.
- **A declared dependency drifts; a binding does not.** The binding is what makes an App reach Keepr Accounts, so it is the dependency.
- **Commits, not versions.** Each app is versioned on its own (ADR-0118): an App's Release names no Keepr Accounts version, and Keepr Accounts' version says when it was released, not which of its changes an App was built beside. Containment of `apps/accounts` commits is exactly "the App's own view of Keepr Accounts".
- **Every App waits, because the workflow cannot tell which bind it.** Whether an App binds Keepr Accounts is known only once its Worker is built, inside its own job, so ordering only the dependents would need a build before the plan. Waiting for every App is one `needs` line. It costs only a wait, and a run whose Keepr Accounts deploy failed is one an operator stops to look at anyway. An App deployed regardless would only meet the order check.
- **An override is for one app.** Each job deploys with the run's inputs, so an override given to a run of several apps would reach every one of their checks and bypass refusals nobody wrote a reason for. Naming one app keeps the written reason about the one refusal it answers.
- **Recorded, because the deploy that needs it cannot rebuild it.** Keepr Accounts' deploy cannot read an App's built Worker for a commit it does not hold built. The App's deploy derives the dependency once, and its marker carries it to every later Keepr Accounts deploy.

### Consequences

- No App binds Keepr Accounts yet, so in production this refuses nothing until Stream Keepr's cutover or Keepr Accounts' first App. Markers from before this decision carry no `needs`, which is true of them.
- The checkout a deploy runs in needs Keepr Accounts' and the dependents' commits and their full history. The Deploy workflow already checks out with `fetch-depth: 0`, and reading a marker fetches its tag's commit; a shallow clone is refused rather than misread.
- A change under `apps/accounts` that is not Keepr Accounts' code (its docs, its tests) counts. It can only make a deploy wait for a Keepr Accounts deploy it did not need; the override exists for when that wait is wrong.
- Only `apps/accounts` counts as Keepr Accounts: a change to a package it shares with an App, such as the shared layer, does not order the two.
- `@keepr/tooling` knows Keepr Accounts by name (`KEEPR_ACCOUNTS` in `order.mjs`): its app, its service and its directory. The tooling's rule "Nothing here knows an app" gains this exception.
- ADR-0119's `BEFORE_REMOTE_CHANGE` list is gone: the CLI's one check is this one, and what it answers the app's markers record.
- Unit-tested at its home with markers in memory and real git histories; the CLI's wiring against a local bare repository as `origin`.

### Rejected alternatives

- **A `dependsOn` list in each descriptor.** It would be one more thing to keep true, and the binding already says it.
- **Comparing Release versions.** Changesets versions each app on its own, and a version names a release, not the Keepr Accounts code beside it.
- **Reading each dependent's dependency from its commit at Keepr Accounts' deploy.** The built Worker configuration is a build output, not in git, and the source configuration is not what the descriptor names.
- **Failing an override that bypassed nothing.** An operator dispatching an override for a refusal that has since cleared would be stopped for no reason; the log says it was unused.
