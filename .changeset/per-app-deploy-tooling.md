---
'@keepr/stream': minor
---

Deploys run through the workspace's deploy tooling, `pnpm run deploy --app stream --env production`, which reads Stream Keepr's deploy descriptor, can deploy a downloaded build, and verifies that `/api/release` names the Release just deployed. The Deploy workflow keeps the `production` GitHub environment and its secrets. The promotion markers are now `stream/production` and `stream/production-validator`. The first deploy of this Release redeploys the silent-video validator once and removes the old `production` and `production-validator` tags on its own.

A local deploy or verify against another origin reads `KEEPR_DEPLOY_URL`, which replaces `STREAM_KEEPR_DEPLOY_HEALTH_URL`.
