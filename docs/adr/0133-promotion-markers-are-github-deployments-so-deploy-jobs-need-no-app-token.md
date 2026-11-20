# ADR-0133: Promotion markers are GitHub Deployments, so deploy jobs need no App token

Accepted · 2026-11-18 · [#1294](https://github.com/KeeprDigital/keepr/issues/1294) · Amends ADR-0119 and ADR-0124 · Amended by ADR-0154: records that any workflow granted `deployments: write` can write a promotion marker

### Decision

**Each promotion marker is a GitHub Deployments environment of its name** (`stream/staging`, `stream/production-validator`, …), no longer an annotated tag on `origin`. Each attempt to deploy the app or a part is a deployment there at the commit it deploys. Its payload holds what the tag's message held (`component`, `commit`, `worktree`, `fingerprint`, `source`, `app`, `environment`, `version`, and an app marker's `needs`, `override` and `recovery`). Its latest status is the marker's state: `in_progress` while it is `pending`, `success` once it is `deployed`. Any other status (`failure`, `error`, `inactive`) confirms nothing and reads as `pending`. A `deployed` write confirms the pending deployment it follows when that recorded the same fields at the same commit; otherwise it is a deployment of its own. The marker is the environment's latest deployment, read back as the same text a tag held, so every reader (the parts decision, deploy order between Keepr Accounts and its Apps, `keepr-deploy status`, a stopped deploy's summary) reads the same states as before.

**The deploy jobs write the markers with `GITHUB_TOKEN`.** The four deploying jobs in `deploy.yml` and the job in `deploy-installation.yml` grant it `contents: read` and `deployments: write`, and nothing broader; the deploy step alone holds it, as `GH_TOKEN` for `gh api`. They mint no App token, and the `staging` and `production` GitHub environments no longer need `KEEPR_RELEASE_APP_ID` or `KEEPR_RELEASE_APP_PRIVATE_KEY`. The `release` environment keeps them: the release GitHub App still pushes the Version PR and the release tags (ADR-0124). A local deploy writes as the operator's `gh` login.

**The tags are read once, as a fallback.** A marker with no deployment yet reads from its tag, so the first deploy after this decision keeps its fingerprint decisions. Nothing writes or removes a tag; an operator deletes each once its marker has a deployment. The pre-ADR-0119 `production` and `production-validator` tags are gone from `origin`, so the tooling no longer reads or retires them.

### Why

- **A tag at a commit whose workflows differ from `main`'s needs `workflows`,** which `GITHUB_TOKEN` can never hold; that is why each deploy job minted the App's token, narrowed to Contents and Workflows (ADR-0124). A deployment is no ref: `GITHUB_TOKEN` creates one at any commit with `deployments: write`, which writes nothing in the repository's contents.
- **The deploy jobs no longer hold a key that can write workflows.** ADR-0124 noted that a Release's install scripts ran beside a token that could push a workflow; the token beside them now writes deployments, and only in the deploy step.
- **GitHub shows them.** Each marker's environment lists its deployments, newest first, with the run that made each, so an Installation's history is visible attempt by attempt, where a tag kept only its latest message.

### Consequences

- **Operator steps**, after this lands. Neither blocks a deploy. Delete `KEEPR_RELEASE_APP_ID` and `KEEPR_RELEASE_APP_PRIVATE_KEY` from the `staging` and `production` GitHub environments once a Deploy has run without them. Delete each marker tag (`stream/staging`, `stream/staging-validator`, `stream/production`, `stream/production-validator`) once the repository's Environments list its marker. A validator whose fingerprint has not changed gets no deployment until it does; deleting its tag sooner costs it one redeploy, the safe default for a missing marker.
- Creating each marker's first deployment creates its environment in the repository's settings, beside `staging`, `production` and `release`. These carry no protection rules and no secrets.
- A local deploy needs `gh auth login` as someone who can write the repository. GitHub refuses a deployment at a commit it does not have, so a local deploy from unpushed commits stops before its first remote change, where a tag push once pushed them.
- `keepr-deploy status` and deploy order list markers through the repository's environments, which a public repository answers with any token.
- The store is tested at its home against GitHub's Deployments API in memory (`deployMarkers.test.ts`), and the command line's wiring through a `gh` stand-in (`deployCli.test.ts`). Only a real Deploy run proves `GITHUB_TOKEN`'s permission against GitHub.
- When every tag is gone, the fallback is dead code, removed in a later change.

### Rejected alternatives

- **Keeping the tags and the App token in the deploy jobs** (ADR-0124). It works, at the cost of a workflows-writing key in every Environment and every deploy job.
- **Commit statuses or check runs as markers.** Both attach to a commit, not to an Installation: reading "what is deployed to production" would mean searching commits.
- **One deployment per marker, its statuses its whole history.** A deployment is fixed at one commit and payload; a deploy of another Release could not move it.
