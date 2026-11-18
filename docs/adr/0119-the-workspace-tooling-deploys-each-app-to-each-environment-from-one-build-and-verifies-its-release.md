# ADR-0119: The workspace tooling deploys each app to each Environment from one build, and verifies its Release

Accepted · 2026-11-17 · [#1262](https://github.com/KeeprDigital/keepr/issues/1262), part of [#1258](https://github.com/KeeprDigital/keepr/issues/1258) · Amends ADR-0035 and ADR-0110 · Amended by ADR-0120: deploy order between Keepr Accounts and its Apps is the check before the first remote change, and the app marker gains `needs` and `override` · Amended by ADR-0125: the Deploy workflow builds each app once in a job of its own and every Environment deploys that artifact; before the first remote change a deploy also reads each D1 database's Time Travel bookmark

### Decision

**Each app states what is deployed in a deploy descriptor; `@keepr/tooling` does the deploying.** The descriptor is `apps/<app>/deploy.jsonc`: the build scripts, the Worker's configuration, the D1 bindings, each Environment's Installation URL (and Wrangler `env` block, when it is not the top level), and the parts deployed from source beside the app, such as Stream Keepr's silent-video validator. It is read from the Release being deployed. An app with a descriptor is deployable; that is what Changesets versions, and a tooling test holds `.changeset/config.json`'s ignore list to it.

**The procedure lives in `packages/tooling/scripts/deploy/` and runs from the workflow's commit.** For one Release of one app to one Environment: build once (build, wrangler dry run, Worker smoke), or place a downloaded artifact of that build; decide each part by fingerprint; run the checks before the first remote change; deploy each part that changed between its markers; then mark the app pending, migrate D1, deploy, verify, mark deployed. It never runs a Release's own `pnpm run deploy`. Locally it is `pnpm run deploy --app <app> --env <env>` (bin `keepr-deploy`), with `wrangler login`; an app's `deploy:*` scripts call it.

**Promotion markers are named `<app>/<environment>[-<part>]`** (`stream/production`, `stream/production-validator`). Their messages gain `app`, `environment` and `version` fields, appended; the header and every earlier field keep their meaning. The `production` and `production-validator` tags are no longer read: the first deploy under the new names redeploys the validator, and a deploy removes each old tag once its replacement records a confirmed deploy.

**A part's fingerprint hashes its Wrangler configuration as resolved for the target Environment**: the top level with that Environment's `env` block over it, as canonical JSON, beside the bundle and the Container's Docker context.

**Every app serves its release identity.** The shared layer records `{ app, version, commit }` into runtime config at build time and gives `readReleaseIdentity`; each app serves it at `GET /api/release`, reachable without a sign-in, beside `/api/time`. The deploy's verify requires it to name the Release just deployed, retrying while the previous Release still answers. A Release from before the endpoint gets a liveness check at `/api/time`, and the output says so.

**The Accounts Stand-in never deploys.** Reading a Release refuses any descriptor whose Worker or part configuration, or whose app, sits under a package marked `keepr.undeployable` (ADR-0113), in every Environment, before anything is built; and the procedure refuses the Worker and part configurations as built or placed from an artifact, before the first remote change.

### Why

- **Keepr Accounts and Score Keepr deploy too** (#1228, #1255). A procedure in `apps/stream` would be copied per app, and its markers named no app.
- **The Release states what it is; the workflow's commit decides how it is deployed.** A rollback reads the descriptor of the Release it rolls back to, so it deploys what that Release built, while every Release, old or new, goes through today's procedure and markers. Running a Release's own `pnpm run deploy` meant a rollback ran an older procedure, and the app marker was written twice.
- **One build per app is what every Environment deploys** (#525 d). Staging and production then run the same bytes, and a downloaded artifact can be deployed.
- **`/api/time` passes for the previous Worker too** (#525 f). A deploy that reported success while the old Release kept serving went unnoticed until the acceptance gates.
- **A staging-only configuration edit must not redeploy production's validator** (#525 c). Hashing the raw `wrangler.jsonc` counted every Environment's block, and its comments.

### Consequences

- `@keepr/stream@1.6.0` and `1.7.0` have no descriptor and no `/api/release`. The tooling deploys them by a built-in descriptor of Stream Keepr as it was then (`PRE_DESCRIPTOR_RELEASES`), checked for liveness only. An app with neither its own descriptor nor a built-in one is refused.
- Landing this changes the validator's fingerprint scheme and its marker's name, so the first deploy after it redeploys production's validator once. Nothing else needs an operator.
- The procedure, the decision, the fingerprint, the markers, the descriptor and the verify are unit-tested at their home with Cloudflare and the marker remote in memory, and the verify against a local HTTP stand-in. Only a real Deploy run proves the tags against GitHub and the deploys against Cloudflare.
- `@keepr/tooling` now knows how an app deploys, but not which app: each app's knowledge is its descriptor. The tooling's rule "Nothing here knows an app" becomes "what it knows of an app, it reads from the app's descriptor or the workspace", except the built-in descriptor and old marker names for Releases from before this decision.
- Deploy order between Keepr Accounts and its Apps (#1263) is a check the procedure runs before the first remote change (`BEFORE_REMOTE_CHANGE` in `cli.mjs`); none exists yet.
- Decision 14 of #1258 spells local deploy `pnpm deploy --app <app> --env <env>`. `pnpm deploy` is pnpm's own command, so it is `pnpm run deploy`.
- `KEEPR_DEPLOY_URL` replaces `STREAM_KEEPR_DEPLOY_HEALTH_URL` as the override of the verify's target, and the deployed acceptance harness's fallback.

### Rejected alternatives

- **A descriptor in JavaScript, imported by the tooling.** It could compute its values, but the tooling would run the Release's code to learn what to deploy. A JSONC file is read, never run.
- **Telling a pre-endpoint Release by a 404 at `/api/release`.** The previous Worker answers 404 too, which is exactly the failure the identity check exists to catch. Whether a Release serves its identity is known from the Release: it has a descriptor.
- **Keeping the old marker names for Stream Keepr's production.** The names would differ by app, and an Environment's marker would name none for Stream alone.
- **Resolving the configuration exactly as Wrangler inherits keys into an `env` block.** Over-including the top level can only redeploy a part more often, never skip one, and does not track Wrangler's list of inheritable keys.
