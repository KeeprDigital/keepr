# ADR-0128: A deploy refuses an Installation missing a required Worker secret

Accepted · 2026-11-18 · [#1282](https://github.com/KeeprDigital/keepr/issues/1282), part of [#525](https://github.com/KeeprDigital/keepr/issues/525) · Amends ADR-0119 · Amended by ADR-0132: a Worker secret named like a var its config sets, or a var left empty, refuses the deploy too; Stream Keepr's Melee key version is a var, not a required secret

### Decision

**The deploy descriptor names the Worker secrets each Installation requires, per Worker.** `worker.secrets` lists the app's Worker's, and a part may list its own as `parts.<name>.secrets`. Each is a list of secret names, validated with the rest of the descriptor; a Worker that lists none requires none. Stream Keepr's are the six its README calls required. `NUXT_BANDAI_KEEPR_API_KEY` is optional and `NUXT_ADMIN_BOOTSTRAP_TOKEN` is set only briefly, so neither is listed, and the silent-video validator requires none.

**A deploy refuses an Installation that lacks one, before its first remote change.** Once built or placed, and before it decides a part, checks deploy order or reads the D1 recovery point, migrates or promotes anything, the deploy procedure reads the secret names set on each Worker that requires some (`wrangler secret list --format json`, against the configuration it deploys and the Environment's Wrangler block). It refuses with every missing name, per Worker, and the `wrangler secret put` command that sets one. Nothing is written and no marker moves. Only names are read; Cloudflare never answers a value.

**A Worker that does not exist has no secrets**, so the first deploy of a new Installation refuses too. Its secrets are set first: `wrangler secret put` creates the Worker. A Wrangler that cannot answer refuses the deploy, with what it said.

**`keepr-deploy check --env <environment>` reports the same without deploying**, reading the app's Worker through its built configuration. Without `--env`, `check` stays CI's Worker leg, which needs no credentials.

### Why

- Release 1.9.0's first staging deploy (run 44249964274) passed `deploy:verify` and the unattended gates with no Worker secrets set, while sign-in answered 503. `/api/release` and the gates that read fixture pages touch no secret, so nothing in the deploy could tell an unusable Installation from a working one.
- The descriptor already states what is deployed (ADR-0119); which secrets a Worker needs is part of that, and a Release states its own, so a rollback checks what that Release needed.
- Before the first remote change is the last moment a refusal costs nothing: no migration has applied, and no marker claims anything.

### Consequences

- A required secret added to the app is added to `deploy.jsonc` in the same change, or deploys do not check it.
- A Release cut before this decision lists no secrets, and its deploy checks none. Stream Keepr's Releases from before descriptors (`1.6.0`, `1.7.0`) read as listing the six they then required.
- Every deploy makes one more Cloudflare read per Worker that requires secrets.
- A new Installation is provisioned in this order: its resources, its Worker's secrets, then its first deploy.

### Rejected alternatives

- **A probe of the deployed Installation that needs a secret** (sign-in, say): it runs after the Worker is live, so it reports the outage instead of preventing it, and it would need an account.
- **Reading the required names from the README:** prose is not a contract, and a Release's own descriptor is what a rollback reads.
- **Creating a missing secret during the deploy:** the values live with the operator, never in CI or the repository.
