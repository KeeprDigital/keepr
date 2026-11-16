# ADR-0035: The app and the validator each carry a promotion marker, and the validator deploys on a build fingerprint

Accepted · 2026-10-21 · [#616](https://github.com/KeeprDigital/stream-keepr/issues/616)

### Decision

**Each component has its own promotion marker**, an annotated tag on `origin`: `production` for the app and `production-validator` for the validator. Its message records the component, a state, the commit, whether that checkout was dirty, who deployed it, and the validator's fingerprint. Every deploy marks its component `pending` before it changes anything remote, and `deployed` once it succeeded. Both deploy commands write the markers themselves: `pnpm run deploy` for the app, `pnpm deploy:validator` for the validator. So an emergency local deploy keeps them accurate too. A deploy whose pending marker cannot be written does not start.

**The validator deploys unless its marker records a confirmed deploy with the target's fingerprint.** The fingerprint is a sha256 of the bundle `wrangler deploy` would upload (the `validator:dry-run` bundle, source maps and README excluded), every file of the Container's Docker context, and `wrangler.jsonc`. A missing, unreadable or `pending` marker, an unknown fingerprint, and a checkout that cannot be bundled all mean deploy. The decision is the pure `decideValidatorDeploy` in `scripts/deploy-promotion.mjs`.

**The Deploy workflow runs the promotion from its own commit.** It checks the release out, and checks `scripts/deploy-promotion.mjs` out of the workflow's commit beside it. It then runs `promote`, which decides, deploys the validator between its markers, marks the app pending, runs the release's `pnpm run deploy`, and marks the app deployed. A release from before this decision can still be rolled back to, with markers. For releases after it, `pnpm run deploy` writes the app marker a second time, to the same states in the same order.

### Why

The one `production` tag stood for both components but moved only after the app succeeded. When the validator of B succeeded and the app of B failed, the tag still said A. Dispatching A then compared A to A and skipped A's validator, leaving A's app beside B's validator (#616). An emergency local deploy moved nothing, so the next comparison started from a wrong baseline. The detection diffed only `workers/silent-video-validator/`, but the Worker imports `@cloudflare/containers` from the root lockfile. A dependency-only change altered the deployed bundle and was skipped.

### Consequences

- The validator's decision, fingerprint, markers and workflow wiring are unit-tested without running git, wrangler or any remote command (`deployPromotion.test.ts`). Production and the marker remote are faked in memory, covering partial failure, rollback and emergency deploy histories. Only a real Deploy run proves the tag writes against GitHub and the deploys against Cloudflare. The real bundle's stability was measured by hand: it contains no absolute or temporary path, and two bundles into different directories hash the same.
- A marker write is a force-push with no compare-and-swap, so the last writer wins. The workflow's concurrency group serialises Deploy runs, but a local deploy during one is not prevented. An annotated tag also pushes the commit it points at, so a local deploy from unpushed commits puts them on `origin`. A local `tag.gpgSign` that cannot sign stops `pnpm run deploy` before its migration.
- The marker format is read by the workflow's commit and written by each release's copy of the script, so it is append-only: add fields, never rename one. The header line is what makes a message a marker.
- The first Deploy after this lands finds no `production-validator` marker, so it redeploys the validator once. The old lightweight `production` tag reads as unreadable until the first deploy replaces it. The environment's deployment-records fallback and the `deployments: read` permission are gone.
- A `pending` app marker after a failure is left until the next deploy confirms one. Rolling the app back from the dashboard or with `wrangler rollback` is not recorded.
- Deploying the validator around its command (bare `wrangler deploy`, a dashboard rollback) bypasses its marker. Recovery is `validator: always` or `pnpm deploy:validator`.
- The fingerprint does not cover the Docker engine or how wrangler builds the image. The Dockerfile pins its base image by digest and its packages to a Debian snapshot, so the context is the image's input. A wrangler upgrade that changes its bundle output redeploys the validator.

### Rejected alternatives

- **Widen the path diff to every input** (the validator folder, `package.json`, `pnpm-lock.yaml`, `shared/`). Release-please bumps `package.json` on every release, so the validator would redeploy every time. Narrowing it to the dependency entries is a list that goes stale silently when the Worker gains an import.
- **Record the fingerprint in Cloudflare** (`wrangler deploy --tag`) and read the deployed version back. That keeps a dashboard rollback accurate, but whether a Worker version's rollback also rolls its Container back is unverified. Reading it back needs the API in the decision, and none of that can be proven without deploying.
- **Move one marker after both components succeed.** It still cannot say "B's validator, A's app", which is the state a rollback must repair.
