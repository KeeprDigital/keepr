---
'@keepr/stream': patch
---

Each Environment's Wrangler configs name its Cloudflare account, so local Wrangler commands reach it with no `CLOUDFLARE_ACCOUNT_ID`, and a deploy refuses an exported one they contradict. The validator's fingerprint leaves the account out, so naming it redeploys nothing. Once it has deployed, `CLOUDFLARE_ACCOUNT_ID` can be deleted from the `staging` and `production` GitHub environments.
