# ADR-0130: Each Environment's Wrangler config names its Cloudflare account

Accepted · 2026-11-18 · [#1285](https://github.com/KeeprDigital/keepr/issues/1285), part of [#525](https://github.com/KeeprDigital/keepr/issues/525) · Amends ADR-0122

### Decision

**Each Wrangler config an app deploys names the account of every Environment it deploys to.** Production's `account_id` is at the config's top level; another Environment's is in its `env.<name>` block. Stream Keepr's `wrangler.jsonc` and its validator's config name production's account at the top level and staging's in `env.staging`.

**No Deploy workflow passes `CLOUDFLARE_ACCOUNT_ID`.** A GitHub environment holds that Environment's `CLOUDFLARE_API_TOKEN` and the release GitHub App's credentials, and no account ID.

**The deploy tooling refuses an exported `CLOUDFLARE_ACCOUNT_ID` the configs contradict.** `keepr-deploy deploy` and `part` read the app's source config and each part's, resolved for the Environment, and stop before building anything when one names another account than the export (`packages/tooling/scripts/deploy/account.mjs`). The deployed acceptance harness takes the account from the configs when nothing is exported, and refuses an export, or an app and validator config, that disagree (`apps/stream/scripts/graphics-acceptance/deployed-target.mjs`).

### Why

- **An account ID is not a secret.** It is in every dashboard URL. Holding it as one only hid it from the config that deploys to it.
- **The config that deploys to an account should name it.** A local `wrangler secret put --env staging`, `wrangler d1 …` or `wrangler tail` then reaches the right account with no export, and a staging command cannot reach production by a stale variable in an operator's shell.
- **Wrangler prefers the config's `account_id` to `CLOUDFLARE_ACCOUNT_ID`** (Wrangler 4.161, `getActiveAccountId`), and an `env` block inherits the top level's unless it names its own (Wrangler's documented inheritable keys). An export that disagrees is therefore ignored by Wrangler, and can only mean the operator meant another account than the one the deploy reaches: refusing says so before anything changes.

### Consequences

- **A Release from before this names no account.** Deployed by the workflow, Wrangler takes the one account the Environment's token reaches; locally, an export or `wrangler login`'s choice. Neither is refused.
- **Production's validator redeploys once.** A part's fingerprint (ADR-0119) hashes its config resolved for the Environment, and the new `account_id` changes it, so the first production deploy of a Release with this change redeploys the validator. Moving an Environment to another account would change it again, which is what that move needs.
- **An app that joins the Deploy workflow names its accounts the same way**, in its own Wrangler config.
- **Once a Release has deployed without it**, a person deletes `CLOUDFLARE_ACCOUNT_ID` from the `staging` and `production` GitHub environments.
