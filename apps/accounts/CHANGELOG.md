# @keepr/accounts

## 0.3.0

### Features

- **accounts:** A Keepr Administrator can make another User a Keepr Administrator from the platform screen, so one whose account is compromised can be disabled by another (#1385). Keepr Accounts' request surface is now closed by default: every response carries a Content Security Policy that forbids framing, HSTS, `nosniff` and a Referrer Policy, and API answers are never stored; Better Auth's routes are closed but for the ones its pages and the Apps use; accepting an Invitation and claiming the first Keepr Administrator refuse a cross-site request; a disabled User's open Session is ended the first time it is used; a User's name is at most 100 characters with no control characters; a Return Address with a control character is refused; and Organisation names are compared in any script. Each administrative change is written in one batch with its Audit Record row, and a First Administrator Claim now lasts a day. There is no step beyond Deploy. (#1401)

### Fixes

- **nuxt-layer:** An App's questions over its binding (an Identity Proof, and the keys it verifies against) are no longer counted by the rate limit, which counted every caller without an address in one bucket a stranger could exhaust for every App (#1386). A browser asking directly is still counted by its address. There is no step beyond Deploy. (#1398)
- **tooling:** The Worker dry run bundles for every Environment the deploy descriptor names, outside the build a deploy uploads, and a deploy refuses a build of another commit or an integration build before it changes anything (#1382). There is no step beyond Deploy. (#1407)
- **stream:** A Screen Output left running stays shown and current through slow or failing networks: a font load or card image that never settles fails after eight seconds, a display on its fallback face stays shown while its asset session retries, and a hung read is superseded once a message has asked for another. A Standings read carries only the rows and columns its Screen shows, and an Event data change refreshes its Screens once per request. Server time re-syncs after a page returns from the back/forward cache, times its round trip on the monotonic clock, and its status reads uncertain rather than synced on an offset it doubts. The shared layer's client state holds up under overlapping requests: a failed optimistic write rolls back only what is still its own, a loading flag stays up while any request holding it runs, Enter ignores IME composition and key repeat, and the unsaved-changes guard asks when only a route's params change (#1380). There is no step beyond Deploy. (#1405)
- **accounts:** An Invitation is accepted only by whoever holds the invited address (#1384, ADR-0155). Its emailed link carries a secret the inviter is never shown, and reading, accepting and declining it need that secret; the inviter is no longer shown the link to copy. Inviting needs a sign-in from the last ten minutes and is capped at 50 an hour per inviter and Organisation; an admin cannot replace an owner's offer; removing a member or disabling a User cancels the Invitations they offered. Deploying cancels every Invitation then open, each recorded in the Audit Record: tell those who invited people to invite them again. There is no step beyond Deploy. (#1400)
- **stream:** Realtime recovers from a publish it lost and judges a changed listener again (#1389). A publish that fails twice is tried again after the write answers, and a Screen Output re-reads every two minutes while healthy, so a lost message cannot leave program stale for long. A page whose credential changes, a Screen Output that changes Screen among them, is admitted afresh; an Event a page has left is forgotten and never reopened by a late subscription. An output that can never be let in again asks ever more rarely, and a refused ticket writes nothing. A Session renewed on a socket's admission now reaches the browser on its next request. Before a data wipe or a restore, a Graphics Administrator can end every Event's realtime with `POST /api/admin/realtime/end-events` (README § Ending every Event's realtime). There is no step beyond Deploy. (#1403)
- **stream:** The shared layer's failed-request log fields can say what a failure was (`errorCause`) and which step failed (`failedStep`). Keepr Accounts does not log them, so nothing it does changes. (#1404)

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
