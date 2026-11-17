---
'@keepr/stream': minor
---

Deploys run through the workspace's deploy tooling, `pnpm run deploy --app stream --env production`, which reads Stream Keepr's deploy descriptor, can deploy a downloaded build, and verifies that `/api/release` names the Release just deployed. The promotion markers are now `stream/production` and `stream/production-validator`. The first deploy of this Release redeploys the silent-video validator once and removes the old `production` and `production-validator` tags on its own; it needs no step beyond running Deploy.
