---
'@keepr/stream': major
---

The Melee key version is the var `NUXT_MELEE_CREDENTIAL_KEY_VERSION` in `wrangler.jsonc`, replacing the Worker secret `NUXT_MELEE_CREDENTIAL_ENCRYPTION_KEY_VERSION`, which nothing reads any more. Both Installations' label is `1`. A deploy refuses a Worker secret named like a var its config sets (ADR-0132). A local `.env` renames the setting.

**Operator step, once this Release is live in an Installation:** delete the old secret there (`wrangler secret delete NUXT_MELEE_CREDENTIAL_ENCRYPTION_KEY_VERSION --config .output/server/wrangler.json`, adding `--env staging` for staging). It is unused, so nothing breaks while it remains.
