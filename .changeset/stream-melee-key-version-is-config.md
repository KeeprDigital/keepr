---
'@keepr/stream': major
---

The Melee key version (`NUXT_MELEE_CREDENTIAL_ENCRYPTION_KEY_VERSION`) is a var in `wrangler.jsonc`, not a Worker secret: staging's is `1`, and production's is an empty placeholder. A deploy refuses a Worker secret named like a var its config sets, and a var left empty (ADR-0132).

**Operator step, before this Release's Deploy run:** delete the `NUXT_MELEE_CREDENTIAL_ENCRYPTION_KEY_VERSION` Worker secret from both Installations (`wrangler secret delete NUXT_MELEE_CREDENTIAL_ENCRYPTION_KEY_VERSION --config .output/server/wrangler.json`, adding `--env staging` for staging). Until then each Installation's deploy refuses. Production also refuses until a Release sets its label in `wrangler.jsonc`'s top-level `vars` to the version production's key runs under, read from a stored credential envelope's `keyVersion` or wherever the value was recorded, never guessed. Between the secret's deletion and the deploy, the running Worker has no key version, so Melee syncs and saving a Melee integration fail: delete it just before the deploy.
