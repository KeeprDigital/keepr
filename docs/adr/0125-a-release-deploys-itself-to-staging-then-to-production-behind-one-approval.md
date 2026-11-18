# ADR-0125: A Release deploys itself to staging, then to production behind one approval

Accepted · 2026-11-18 · [#525](https://github.com/KeeprDigital/keepr/issues/525) · Amends ADR-0035, ADR-0036, ADR-0118, ADR-0119, ADR-0122 and ADR-0124, and the Deploy workflow's stated policy that deploys are "never merge- or release-triggered"

### Decision

**A Release dispatches its own Deploy.** Once the release workflow has passed the release gate (ADR-0036), tagged the commit and published the GitHub Releases, its `deploy` job starts one Deploy run with every app it released (changesets/action's `published-packages`), to staging and then production. It dispatches with `GITHUB_TOKEN`, given `actions: write` in that job alone; nothing else in the release run can write with it. Nothing is dispatched when nothing was released. **Deploys stay never merge-triggered**: a merge to `main` that releases nothing deploys nothing, and what deploys is always a released tag.

**The Version PR stays a draft until a person marks it ready.** changesets/action opens it as a draft and makes it one again whenever it updates it (`pr-draft: always`). CI skips a draft, so marking it ready for review is what starts its CI, and "ready" means "release exactly this content". The release act is: mark the Version PR ready, wait for `CI passed`, queue it.

**Each app builds once per run, and every Environment deploys that build.** A build job per app (`deploy-build.yml`) runs `keepr-deploy build --artifact`: the descriptor's build, dry run and Worker smoke, uploaded as the run's artifact `build-<app>`. Each Installation's job (`deploy-installation.yml`) downloads it and runs `keepr-deploy deploy --artifact`; the Release checkout stays for its migrations, parts and Wrangler.

**Staging, then production, per app.** The staging jobs run in the GitHub environment `staging`, with no approval, and after their deploy run the app's **unattended acceptance gates**: package scripts the deploy descriptor names in `gates`, each reading the Installation at `KEEPR_DEPLOY_URL` and writing nothing (`keepr-deploy gates`). Stream Keepr's are the still-image and silent-video browser gates. The production jobs need every App's staging job and run in the GitHub environment `production`, whose required reviewer is the approval: one "Review deployments" approves every App's production job together. Keepr Accounts reaches each Environment before the Apps (ADR-0120), so a run that deploys it waits for two approvals, its own first.

**The D1 recovery point is read, not typed.** Before its first remote change, every deploy, in every Environment and however it was started (the workflow, a dispatch by hand, a local `pnpm run deploy`), reads each D1 database's current Time Travel bookmark (`wrangler d1 time-travel info <binding> --json` against the built configuration and the Environment's block), refuses without one, logs how to restore it, and records it in the app's marker as `recovery: <binding>=<bookmark>`. The Deploy workflow's `d1_recovery_point` input is gone.

**"Nothing on air" is confirmed at the approval.** The plan job's step summary, on the run's page beside "Review deployments", lists what to confirm before approving production. GitHub's review dialog shows only the environment's name and a comment box, and an environment has no description, so the summary is where the checklist can be.

**A manual dispatch stays**, for a rollback or a redeploy: any published Release, to production alone, staging alone, or staging then production. Production is behind its approval either way.

### Why

- **Production was the staging gate** (#525): the writing acceptance gates provisioned real Events in production, and a D1 migration first met remote D1 there. A Staging Installation in its own account (ADR-0122) takes both, and a Release that reaches it with no human action is proved there before anyone approves production.
- **One approval is the one human step** after the release act. A typed word proved nothing about the database; the approval is a person's attention, and the bookmark is the database's answer.
- **Build once** (ADR-0119): production deploys the bytes staging ran, and `/api/release` shows which Release that is. Rebuilding per Environment would deploy bytes no gate ran.
- **The release workflow dispatches; Deploy does not listen for Releases.** A `release` event fires once per app, and the Apps of one Release would deploy in separate runs, each with its own approval. One dispatch carries every app the Release published.
- **The draft Version PR** keeps an update the action makes after a person looked from releasing unseen, and spends no CI on a Version PR nobody is releasing yet.

### Consequences

- The `production` GitHub environment needs a required reviewer; without one, production deploys right after staging. Setting it is outside the repository.
- A failed staging job holds every App's production job in that run. Fix forward and redeploy the Release, or dispatch the apps that passed by hand.
- Gates that write still need a person to start them, against staging (`pnpm accept deployed` with `STREAM_KEEPR_ACCEPTANCE_ENVIRONMENT=staging`). Fault injection stays manual.
- Only the browser gates that read fixture pages run unattended. The fonts gate stages a library ingestion and signs in, and the validator gate writes with Wrangler and needs Docker, so neither can.
- A Release older than this decision names no `gates`, and its staging job says so and passes. A rollback to it reads its database's bookmark like any other deploy.
- The artifact lives as long as the repository keeps artifacts; a production approval that waits beyond that fails its download, and the Release is redeployed.

### Rejected alternatives

- **Deploying on every merge to `main`** (decided 2026-11-03): the release gate and the Version PR are the release act; a merge is not a Release.
- **A gate job holding the approval, with the deploy jobs unprotected:** environment secrets reach only jobs in that environment, so the production deploy jobs need `production` themselves, and each waits for its reviewer.
- **A separate step re-drafting the Version PR with the App's token** (`gh pr ready --undo`): the action's own `pr-draft: always` opens it as a draft, so no CI run starts on an opened Version PR first, and re-drafts it in the same update.
