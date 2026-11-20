# ADR-0134: 1Password holds every secret, and one command syncs it

Accepted · 2026-11-18 · [#1290](https://github.com/KeeprDigital/keepr/issues/1290) · Amends ADR-0128 · Amended by ADR-0135: `--generate` writes the value as an `op` argument, since `op` 2.42 keeps no concealed value from piped JSON, and reads it back before syncing it · Amended by ADR-0154: `--generate` confirms the destination answers before writing 1Password, and a sync that fails after names the command that finishes it

### Decision

**1Password is the record of every secret's value.** One vault, `Keepr`, holds a Secure Note per place a set of secrets is used, each secret a concealed field named exactly after it: `stream-staging` and `stream-production` for Stream Keepr's Installations, `github-staging` and `github-production` for those GitHub environments, and `keepr-release` for the release GitHub App's credentials, which the `release` GitHub environment holds. A later Installation follows the pattern: `accounts-<environment>`, `score-<environment>`. A title takes a hyphen, never a `/`, which would break an `op://` reference. An empty field means the value is not recorded yet.

**A committed map says where each value is kept and used, and holds no value.** `secrets.jsonc` at the root maps each secret of an app's Installation's Worker (`workers.<app>.environments.<environment>`) and of a GitHub environment (`github.<environment>`) to its `op://Keepr/<item>/<field>` reference. A Worker's names are its deploy descriptor's `worker.secrets` (ADR-0128) plus those the map calls `optional`, which no deploy requires (Stream Keepr's `NUXT_BANDAI_KEEPR_API_KEY`); the map adds only the location, and the sync and the tooling's tests refuse a map that disagrees with a descriptor. A part that requires secrets is refused too, until the sync sets parts'.

**`pnpm secrets:sync` sets them** (`packages/tooling/scripts/secrets/`):

- `--app <app> --env <environment>`: every recorded value of the Installation's Worker, in one `wrangler secret bulk` with the app's own Wrangler, against its source config and the Environment's block, so the config names the account (ADR-0130). A source config that leaves the Worker's name to the build takes the descriptor's new `worker.name` (Stream Keepr's production: Nitro names it `stream`).
- `--github <environment>`: each recorded value, with `gh secret set --env`.
- `--check`: sets nothing, and names each secret the destination lacks, each 1Password does not record, and each the destination has that the map does not name. Cloudflare and GitHub answer names only, so a value that differs cannot be seen.

It reads 1Password with the `op` CLI, an item at a time. It never sets an unrecorded value, and names each. It passes every value on stdin, never in an argument, prints none, and removes any from what a failing tool printed. It fails while a secret an Installation requires is unrecorded or, with `--check`, unset. The deploy's refusal for a missing Worker secret names the sync.

**A secret that is random by nature is generated into 1Password first.** `--generate <NAME>`, once per secret, writes a new 32-byte base64 value (`openssl rand -base64 32`'s) into its field, then syncs the Installation. Only a secret the map lets be generated is, and the map's warning of what a new value does is printed first: a new `NUXT_BETTER_AUTH_SECRET` signs every User out; a new `NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY` revokes every Screen Output asset capability. `NUXT_MELEE_CREDENTIAL_ENCRYPTION_KEY` is refused: its rotation is a Release that bumps the `NUXT_MELEE_CREDENTIAL_KEY_VERSION` var and keeps the old key (ADR-0132). A secret its provider issues (an Ably key, a Cloudflare token, the App's key) is recorded by hand.

**CI keeps GitHub environment secrets.** No workflow reads 1Password: the environments' branch policies and production's reviewer protect what they hold, and a 1Password credential in CI would be one more secret to protect.

### Why

- On 2026-11-18 the staging deploy token was rolled because its value existed nowhere else, and the staging Worker secrets had been set by a one-off script that kept no copy. Cloudflare and GitHub never show a value again.
- More Installations are coming (Keepr Accounts and Score Keepr, each in staging and production), each with its own set, and every rotation repeats the work by hand.
- The descriptor already names each Installation's required secrets; a second list of names would drift from it.

### Consequences

- An operator needs `op` signed in to the `Keepr` vault, and `wrangler login` or `gh auth login` for the destination.
- A new secret is added to the descriptor (when a deploy requires it), the map and its 1Password item in one change.
- A rotation of a provider's value is: record it in 1Password, then sync.
- One `wrangler secret bulk` makes one new Worker version for the whole set, where a `wrangler secret put` per secret made one each. It creates a Worker that does not exist, as `put` does, so a new Installation is still provisioned as ADR-0128 says: resources, secrets, first deploy.

### Rejected alternatives

- **A 1Password service account in CI, reading at deploy time:** one more credential to protect, and GitHub's environment protections already guard what CI uses.
- **`op read` per secret:** an item read once is one call per item, and tells an empty field from one that is missing.
- **Generating by `op item edit 'FIELD=value'`:** the value would be an argument, visible to other processes; the item's JSON goes on stdin instead.
