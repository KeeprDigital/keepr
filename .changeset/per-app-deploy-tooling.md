---
'@keepr/stream': major
---

Deploys run through the workspace's deploy tooling, `pnpm run deploy --app stream --env production`, which reads Stream Keepr's deploy descriptor, can deploy a downloaded build, and verifies that `/api/release` names the Release just deployed. The promotion markers are now `stream/production` and `stream/production-validator`. The first deploy of this Release redeploys the silent-video validator once and removes the old `production` and `production-validator` tags on its own.

Before running Deploy, the operator:

- creates the GitHub environment `stream-production`, with deployment branches limited to `main`, holding `CLOUDFLARE_ACCOUNT_ID` and a `CLOUDFLARE_API_TOKEN` for Stream Keepr alone, re-created from the old `production` environment's values (delete `production` once a deploy through `stream-production` is confirmed);
- for a local deploy or verify against another origin, sets `KEEPR_DEPLOY_URL`, which replaces `STREAM_KEEPR_DEPLOY_HEALTH_URL`.
