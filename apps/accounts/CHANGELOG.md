# @keepr/accounts

## 0.2.1

### Other changes

- **nuxt-layer:** The shared layer's identity resolver shares the Identity Proofs and keys it verifies across an App's Worker isolates, through the Worker's Cache API (#1375). Nothing Keepr Accounts does changes. There is no step beyond Deploy. (#1390)

## 0.2.0

### Features

- **accounts:** Keepr Accounts tells an App what to call a User, at `GET /api/users/names?id=…` (ADR-0145). It answers the Session whose cookie the request carries, never an App for itself, with the name of each User asked about who shares an Organisation with that Session's User, and nothing else of them: no email, role or Organisation. An id no User has, a User in none of the asker's Organisations and a User with a blank name are left out alike. A Keepr Administrator is answered as anyone is. A request with no Session is refused 401, and one about more than 50 Users 400. There is no step beyond Deploy. (#1357)

### Fixes

- **accounts:** A User always has a name. Keepr Accounts refuses a blank one, empty once trimmed or not text, 400 `NAME_REQUIRED` on every path that sets a name: accepting an Invitation, claiming the first Keepr Administrator, and a change on the profile, where Better Auth's `/update-user` saved one until now. The profile says "Enter your name." beside the name, and a name is kept trimmed. No stored name is rewritten. (#1355)

### Other changes

- **stream:** The shared layer's identity resolver says, with each signed-in answer, whether its Identity Proof was held, held and being refreshed, or asked of Keepr Accounts while the request waited, for an App's log to name (#1363). Nothing Keepr Accounts does changes. There is no step beyond Deploy. (#1372)

## 0.1.0

### Features

- **accounts:** Keepr Accounts is released and deployed on its own: at `https://accounts.keepr.digital` in Production and `https://accounts.keepr-staging.digital` in Staging, each Installation in its Environment's Cloudflare account, with its own identity database and sending domain. Each Installation keeps its session cookie, Return Addresses and email to its own Keepr domain. A deploy refuses an Installation without `NUXT_BETTER_AUTH_SECRET`. (#1305)

  **Before its first deploy to an Environment**, stand the Installation up as `apps/accounts/README.md` § Standing up an Installation says: create the identity database and land its ID in `wrangler.jsonc`, set the sign-in secret, onboard the sending domain with Email Routing left off, then deploy and claim the first Keepr Administrator.
