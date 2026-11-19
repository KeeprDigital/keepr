---
'@keepr/stream': major
---

Stream Keepr relies on Keepr Accounts, and its own sign-in is removed (ADR-0141). A User signs in at Keepr Accounts and is sent back; Stream Keepr's login, password reset and user administration pages, its first-admin bootstrap and its Better Auth are gone. Every route behind the Session boundary admits a request only on an Identity Proof from Keepr Accounts, refuses a User with no App access to `stream` 403, and admits a Graphics Administrator by the `admin` App role. The Worker binds `keepr-accounts` as `KEEPR_ACCOUNTS` in every Environment, so a deploy refuses an Environment whose Keepr Accounts is not deployed, or is behind (ADR-0120). The deploy's migration drops the `user`, `session`, `account`, `verification` and `rateLimit` tables: no Stream Keepr User is carried over. Nothing skips sign-in locally any more: the `:bypass` scripts are gone, and `pnpm dev` is answered by the Accounts Stand-in.

Operator steps, for each Environment (staging, then production):

1. **Before this Release deploys**, check Keepr Accounts is deployed there. Stream Keepr's deploy refuses otherwise, before it changes anything.
2. **Before this Release deploys**, invite whoever needs Stream Keepr in that Environment's Keepr Accounts (`/invite`), with App access to `stream`: `admin` for a Graphics Administrator, `member` for anyone else. Until someone is invited, nobody can use the Installation.
3. **Before this Release's Deploy run, for staging**: the acceptance gates now sign in to Staging's Keepr Accounts. Invite their operator there with `admin` in `stream`, record that User's email and password as `STREAM_KEEPR_ACCEPTANCE_OPERATOR_EMAIL` and `STREAM_KEEPR_ACCEPTANCE_OPERATOR_PASSWORD` in 1Password (item `github-staging`), and run `pnpm secrets:sync --github staging`. With the old operator's values the staging job fails and production does not deploy.
4. **Once this Release is live in an Installation**, delete the Worker secrets Stream Keepr no longer reads: `pnpm exec wrangler secret delete NUXT_BETTER_AUTH_SECRET --config .output/server/wrangler.json`, and the same for `NUXT_ADMIN_BOOTSTRAP_TOKEN` if it is set (add `--env staging` for staging). Then remove the `NUXT_BETTER_AUTH_SECRET` field from the 1Password items `stream-staging` and `stream-production`. Nothing reads either, so nothing breaks while they remain.

Every browser signs in again, at Keepr Accounts. Work recorded under a former User's id (an unfinished Graphics Ingestion Operation, an Evidence Ledger entry) keeps that id, which no User now has. A rollback of the Worker past this Release finds no sign-in tables: restore the deploy's D1 recovery point with it, or fix forward.
