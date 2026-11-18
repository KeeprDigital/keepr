# ADR-0132: A name is a Wrangler var or a Worker secret, never both

Accepted · 2026-11-18 · [#1292](https://github.com/KeeprDigital/keepr/issues/1292) · Amends ADR-0128

### Decision

**Stream Keepr's Melee key version is a var, under a new name.** The label of the active Melee key is not secret, so each Environment's `wrangler.jsonc` sets it as `NUXT_MELEE_CREDENTIAL_KEY_VERSION` (runtimeConfig `meleeCredentialKeyVersion`): production's at the top level and staging's in `env.staging`, both `1`. It replaces the Worker secret `NUXT_MELEE_CREDENTIAL_ENCRYPTION_KEY_VERSION`, which `worker.secrets` no longer lists and the runtime no longer reads. The runtime still refuses an empty label (`MELEE_CREDENTIAL_KEY_VERSION_MISSING`). A Melee key rotation changes the var in a Release together with the key.

**The var takes a new name so the move needs no outage.** Cloudflare will not deploy a var under a name a Worker secret already holds. Under the old name, an Installation would have to delete the secret and then deploy, with Melee broken in between. Under the new name, the Release deploys beside the old secret, which stays set and unused, and the operator deletes it once the Release is live.

**A deploy refuses a Worker secret named like a var.** Before its first remote change, the deploy reads each Worker's vars for the Environment from the Release's source config, beside the secret names it already reads (ADR-0128). It refuses a Worker carrying a secret named like one of its vars and gives the `wrangler secret delete` command that removes it. Cloudflare would otherwise refuse the upload itself, after migrations have applied.

### Why

- A label set as a secret was one more value per Installation to set, store (#1290) and check (#1282), and hid from the config which key version an Installation runs.
- A refusal before any remote change costs nothing. Cloudflare's refusal comes mid-deploy.

### Consequences

- Once this Release is live in an Installation, its operator deletes the old `NUXT_MELEE_CREDENTIAL_ENCRYPTION_KEY_VERSION` Worker secret there. Nothing reads it, and nothing refuses while it remains.
- A local `.env` renames the setting to `NUXT_MELEE_CREDENTIAL_KEY_VERSION`.
- A rollback to a Release from before this decision requires the old secret (its descriptor lists it).
- Any app's var follows the same rule, the validator's included.

### Rejected alternatives

- **Keep the name, and delete the secret before deploying:** Melee syncs fail in each Installation from the deletion until the deploy, timed by hand.
