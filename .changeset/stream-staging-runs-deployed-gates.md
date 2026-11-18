---
'@keepr/stream': major
---

The Deploy workflow's staging job runs every deployed acceptance gate (`pnpm accept:deployed`, gates 1–6 of README § Deploy day) against the Staging Installation before production's approval, and a deployed gate refuses production when it runs in CI. The validator gate keeps its cleanup manifest in the Installation's staging bucket, so the next run, wherever it runs, deletes what a failed run left.

**Operator step, before this Release's Deploy run:** add `STREAM_KEEPR_ACCEPTANCE_OPERATOR_EMAIL` and `STREAM_KEEPR_ACCEPTANCE_OPERATOR_PASSWORD`, an operator account on the Staging Installation, as secrets of the `staging` GitHub environment, and give its `CLOUDFLARE_API_TOKEN` Workers R2 Storage:Edit. Without them the staging job fails and production does not deploy.
