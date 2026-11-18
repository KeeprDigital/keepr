# ADR-0132: A name is a Wrangler var or a Worker secret, never both

Accepted · 2026-11-18 · [#1292](https://github.com/KeeprDigital/keepr/issues/1292) · Amends ADR-0128

### Decision

**Stream Keepr's Melee key version is a var, not a Worker secret.** `NUXT_MELEE_CREDENTIAL_ENCRYPTION_KEY_VERSION` labels the active Melee key and is not secret, so each Environment's `wrangler.jsonc` sets it: production's at the top level, staging's (`1`) in `env.staging`. `worker.secrets` no longer lists it. The runtime reads it as before and still refuses an empty label (`MELEE_CREDENTIAL_KEY_VERSION_MISSING`). A Melee key rotation changes the var in a Release together with the key.

**Neither wins when a var and a Worker secret share a name: the deploy refuses.** Before its first remote change, the deploy reads each Worker's vars for the Environment from the Release's source config, beside the secret names it already reads (ADR-0128), and refuses a Worker carrying a secret named like one of its vars, with the `wrangler secret delete` command that removes it. Which of the two a Worker would read is Cloudflare's to decide, not the Release's, so the Release does not let it come to that.

**A var left empty is a placeholder, and the deploy refuses it.** An empty or blank string var in the config deployed to an Environment stops the deploy, naming it. Production's key version is such a placeholder until its operator writes the label production's key runs under: it could not be read from the code or docs, and guessing it would encrypt new credentials under a label the stored ones do not carry.

### Why

- A label set as a secret was one more value per Installation to set, store (#1290) and check (#1282), and hid from the config which key version an Installation runs.
- A secret left behind once its name became a var would leave the Worker's value to Cloudflare, with the config claiming another.

### Consequences

- Moving the label off a secret is an operator step per Installation: delete the `NUXT_MELEE_CREDENTIAL_ENCRYPTION_KEY_VERSION` Worker secret. Until then the deploy refuses that Installation.
- Production deploys refuse until a Release sets production's label. The operator reads it without the key, from a stored credential's envelope (its `keyVersion`; `apps/stream/server/utils/meleeCredentialCrypto.ts`), or from where the value was recorded.
- A rollback to a Release from before this decision requires the secret again (its descriptor lists it), and with it set, deploys as it did.
- Any app's var follows the same two rules, the validator's included.

### Rejected alternatives

- **Let the var win, or the secret:** neither is the Release's to choose, and a silent choice is how a rotation's label diverges from the key.
- **A guessed production label (`1`, as staging):** a wrong label encrypts new credentials under it, and every stored one then asks for a key version the keyring lacks, so Melee syncs fail until the label is corrected.
