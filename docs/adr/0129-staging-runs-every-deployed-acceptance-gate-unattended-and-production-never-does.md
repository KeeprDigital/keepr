# ADR-0129: Staging runs every deployed acceptance gate unattended, and production never does

Accepted · 2026-11-18 · [#1283](https://github.com/KeeprDigital/keepr/issues/1283), part of [#525](https://github.com/KeeprDigital/keepr/issues/525) · Amends ADR-0125, and what #525 decided on 2026-11-04: "only the smoke and browser gates run in the staging job; any gate that writes data needs a human to start it, against staging"

### Decision

**The staging job runs every deployed acceptance gate.** After `deploy:verify`, a Release's staging job runs the deploy descriptor's `gates` against the Staging Installation with no person present (`keepr-deploy gates`). Stream Keepr's is `pnpm accept:deployed`, the deploy-day sequence, gates 1–6 of `apps/stream/README.md` § Deploy day: the validator, graphics delivery, still images, silent video, fonts and Template Package gates, which sign in and write. A failure fails the job, so production's approval means every deployed gate passed on the build it deploys. Fault injection (gate 7) stays a person's, against staging.

**They sign in as a staging operator.** `STREAM_KEEPR_ACCEPTANCE_OPERATOR_EMAIL` and `STREAM_KEEPR_ACCEPTANCE_OPERATOR_PASSWORD` are secrets of the `staging` GitHub environment, passed by name to the Apps' staging call alone and read by the gates step alone, beside the Cloudflare credentials the validator gate writes with. The step names the Environment (`STREAM_KEEPR_ACCEPTANCE_ENVIRONMENT`).

**Gates never run against production unattended.** A deployed run that resolves production while `CI` is set refuses before it reaches the Installation (`harness-precondition-unmet reason=production-unattended`), whatever started it. Production runs no gate; a person may still run one against production from a checkout.

**The validator gate's cleanup manifest lives in the Installation.** It is an object in the target's own staging bucket, `acceptance/silent-video-validator-cleanup.json`, beside the keys it lists, so it survives the CI runner that wrote it. A key is recorded there before it is written, as before (#619). A run whose deletes fail still fails; the next deployed run, wherever it runs, deletes what the manifest lists before it stages anything, and stops with `harness-cleanup-pending` only if some of it still cannot be deleted. A manifest an earlier run kept on its machine, under `.cache/acceptance/`, is still read there and moves into the bucket.

### Why

- **The reason for a person has gone from staging.** #525 kept the writing gates manual because production was where they wrote. Staging is its own Cloudflare account (ADR-0122), with its own data and Ably app, so a gate that writes there writes nothing anyone relies on.
- **An approval should mean the gates passed.** With the writing gates manual, approving production approved a build whose gates 1–6 may never have run.
- **The manifest goes where the objects are.** A file on a runner is gone when the job ends, and R2 cannot be listed through Wrangler, so a run on a fresh machine could not find what an earlier one left. In the bucket, every run against that Installation reads the same record, and each Environment's is its own.

### Consequences

- The `staging` GitHub environment needs the operator pair, an operator account on the Staging Installation; without it the gates stop with `harness-operator-unavailable` and production does not deploy. Its `CLOUDFLARE_API_TOKEN` also needs to read and write the staging bucket's objects and trigger the validator's Workflow.
- Two deployed runs against one Installation at once share its manifest; the Deploy workflow runs one deploy per Installation, and a person starts a run by hand only while none is running there.
- A Release from before this decision names `accept:unattended`, and its staging job runs the two browser gates, as it did.
