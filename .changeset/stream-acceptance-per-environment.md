---
'@keepr/stream': minor
---

The deployed acceptance gates target one Environment, named by `STREAM_KEEPR_ACCEPTANCE_ENVIRONMENT` (production when unset): `pnpm accept deployed` checks the URL and account against that Environment's Wrangler configs, and the validator gate keeps one cleanup manifest per Environment. A production cleanup manifest left at the old path moves to production's on its next run.
