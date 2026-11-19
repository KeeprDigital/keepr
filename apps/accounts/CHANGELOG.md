# @keepr/accounts

## 0.1.0

### Features

- **accounts:** Keepr Accounts is released and deployed on its own: at `https://accounts.keepr.digital` in Production and `https://accounts.keepr-staging.digital` in Staging, each Installation in its Environment's Cloudflare account, with its own identity database and sending domain. Each Installation keeps its session cookie, Return Addresses and email to its own Keepr domain. A deploy refuses an Installation without `NUXT_BETTER_AUTH_SECRET`. (#1305)

  **Before its first deploy to an Environment**, stand the Installation up as `apps/accounts/README.md` § Standing up an Installation says: create the identity database and land its ID in `wrangler.jsonc`, set the sign-in secret, onboard the sending domain with Email Routing left off, then deploy and claim the first Keepr Administrator.
