# ADR-0141: Stream Keepr relies on Keepr Accounts, and its own sign-in is removed

Accepted · 2026-11-19 · [#1327](https://github.com/KeeprDigital/keepr/issues/1327) · Supersedes ADR-0017 · Amends ADR-0010, ADR-0012, ADR-0018, ADR-0113, ADR-0121 and ADR-0131 · Amended by ADR-0143: `GET /api/realtime/token` is gone, so it is not among the routes outside the boundary and asks nobody who a request belongs to

Keepr Accounts holds every User and is deployed in both Environments (ADR-0112), and until now no App relied on it. Stream Keepr still ran its own Better Auth over its own `user`, `session`, `account`, `verification` and `rateLimit` tables, with its own login, password reset, user administration and first-admin bootstrap, and `STREAM_KEEPR_LOCAL_AUTH_BYPASS` was still a name a deployed Worker could carry (ADR-0017's residual). The owner decided that no Stream Keepr User is carried over, because there are none, and that sign-in moves and the old tables are dropped in one Release.

### Decision

**Stream Keepr learns who a request belongs to only from an Identity Proof**, asked of Keepr Accounts over the `KEEPR_ACCOUNTS` service binding to `keepr-accounts`, which every Environment binds, and verified by the layer's `resolveRequestIdentity` (ADR-0113). `server/utils/session.ts` is the one place that asks: `requestIdentity` answers the User and Session, or `null` for a signed-out visitor, once per request, and refuses a User with no App access to `stream` there, by the layer's `requireAppAccess`. No caller can hold an Identity without App access, and nothing in the app, a build or a request (no setting, variable, header or query) admits a request without a proof that verifies.

**The Session boundary keeps its rule and its own refusals.** `server/middleware/api-session.ts` still denies every `/api/**` route by default, still refuses a state-changing request another site's page made 403 before the Session is read, and still answers a request with no Session the one literal 401, "Authentication is required", in place of the layer's own 401. Two refusals composed there are the layer's, in the layer's words: 403 `NO_APP_ACCESS` for a User with no App access, and 503 while no Identity Proof can be trusted and Keepr Accounts does not answer.

**The routes outside the boundary are exactly** `/api/time`, `/api/release`, `/api/realtime/token`, `/api/screen-output/**` and `/api/public/**`. `/api/auth/**` and `/api/bootstrap/ensure-admin` are gone with what they served, and nothing of sign-in replaces them: a User signs in at Keepr Accounts, on its own host. `/api/identity`, which answers who the browser is, is behind the boundary like any other route.

**The two routes with a second credential ask for themselves, each its own way.**

- `GET /api/realtime/token` asks `requestIdentity`: a signed-out visitor with no Screen Output Asset Capability gets the route's own 401, a User with no App access the layer's 403, and an unreachable Keepr Accounts the layer's 503. The grant holds while an Installation is on Ably (ADR-0137).
- A Screen Output read asks `optionalIdentity`, which answers `null` for a User with no App access and while Keepr Accounts cannot be asked. So those routes keep refusing 404, never 401 or 403, and a Screen Output that presents its capability never waits on Keepr Accounts. Only a route with a credential-free arm may call it.

**A Graphics Administrator is a User whose Identity Proof names the `admin` App role in `stream`.** `requireGraphicsAdministrator` reads it with the layer's `requireAppRole`, so its 403 is the layer's, `APP_ROLE_REQUIRED`, as every App refuses one. This departs from ADR-0131's "in the existing words": the sentence "Graphics Administrator authorization is required" is gone. Each admin page still says who it is for.

**Everything about an account is at Keepr Accounts.** Stream Keepr has no login, password reset or user administration page, and ends no Session: its shell links to the User's profile at Keepr Accounts, where they sign out and choose the Organisation they work in. The page gate (`app/middleware/access.global.ts`) sends a signed-out visitor there to sign in, through the layer's `useIdentity`, with the page they were on as the Return Address; shows a User with no App access `/no-access`; and lets a navigation through when it could not find out. `NUXT_PUBLIC_KEEPR_ACCOUNTS_ORIGIN`, a var of each Environment in `wrangler.jsonc`, names that Environment's Keepr Accounts, so Staging sends nobody to Production's sign-in.

**There is no local bypass of any kind.** The `:bypass` scripts, `STREAM_KEEPR_LOCAL_AUTH_BYPASS`, `build/localAuthDeployment.ts`, the Local Developer Session and the `test:local-auth` suite are removed. Local work is served by the Accounts Stand-in (ADR-0113): `pnpm dev`, `pnpm preview` and `pnpm worker:smoke` each run through `keepr-accounts-stand-in -- <command>`, and the integration suite starts each of its servers through it.

**The Accounts Stand-in answers as whoever its cookie names.** A request with no `keepr-stand-in` cookie is still the Local Developer User with full authority. The cookie, which an App forwards to Keepr Accounts as it forwards a session cookie, may name a signed-out visitor (the stand-in answers 401), another User, another Session of one User, and an App role or none in each App. `@keepr/accounts-stand-in/cookie` builds it. This amends ADR-0113's "seeing the App as someone with less needs the real Keepr Accounts".

**Each `keepr-accounts-stand-in -- <command>` run keeps a Wrangler registry of its own.** It makes a temporary directory, sets `WRANGLER_REGISTRY_PATH` to it for the stand-in and the command, starts the command only once the stand-in is registered there, and removes it when the command ends. What Wrangler writes for the stand-in goes to a temporary directory of the run's own as well: two stand-ins started from one checkout at once, as the integration suite starts them, would otherwise open the same local state, and `workerd` refuses to start on a locked file. Realtime's dev Worker (ADR-0138) leaves a registry already named alone, so the stand-in and that Worker register in the one registry the dev server's bindings read, and two dev servers at once never find each other's Workers. The run marks its registry (`KEEPR_ACCOUNTS_STAND_IN_REGISTRY`), and a run inside it that would register in the same one starts no second stand-in. A registry already named is used as named, and the stand-in started alone registers where Wrangler does by default. With `KEEPR_ACCOUNTS_STAND_IN=off`, the App and the real Keepr Accounts beside it are both started under one `WRANGLER_REGISTRY_PATH`.

**The integration suite starts each of its servers through the stand-in**, a stand-in and a registry each, and does not wrap Vitest in one.

**`pnpm dev:local` is ADR-0018's accepted exposure.** Every local server answers a request with no cookie as the Local Developer User, so the launcher bound to `0.0.0.0` gives every machine that can reach it that User's access, exactly as `dev:local:bypass` did. The `:bypass` suffix marks nothing any more.

**Locally, every browser is in one Session.** The stand-in answers one Session id unless its cookie names another, so two browsers are one editor to a Graphics Authoring Lease. A second editor sets the cookie (`document.cookie = 'keepr-stand-in=session=second'`) or runs beside the real Keepr Accounts.

**The migration `0005_keepr_accounts_identity` drops `account`, `rateLimit`, `session`, `user` and `verification`**, and adds `graphics_authoring_leases.holder_name`. No other table referred to them by a foreign key. What still names a User afterwards is the id alone: an Evidence Ledger entry's actor and a Graphics Ingestion Operation's `initiated_by`; a lease's `holder_session_id` names a Session. From this Release they hold Keepr Accounts' ids. Rows already written keep theirs, which now resolve to no one.

**A Graphics Authoring Lease keeps its holder's name**, as their Identity Proof gave it when the lease was taken, and shows it to a Session that finds the artifact held.

**An administrator reading names only its reader.** Stream Keepr holds no Users, and a name reaches it only in the Identity Proof of the request in hand. So the Operations Cockpit, a queue inspection and the Evidence Ledger name the reader's own id, by their name or else their email; label an anonymous-era author; and show every other actor, another User's id included, as it was recorded. This narrows ADR-0010's "display name resolved at read time". Naming other Users needs either Keepr Accounts to answer names to an App or Stream Keepr to keep the names it has seen, and is deferred to work of its own.

**Stream Keepr holds no sign-in secret.** The Worker secrets `NUXT_BETTER_AUTH_SECRET` and `NUXT_ADMIN_BOOTSTRAP_TOKEN` are read by nothing, and `deploy.jsonc` no longer requires the first. The deployed acceptance gates sign in to the Installation's Keepr Accounts, as `STREAM_KEEPR_ACCEPTANCE_OPERATOR_EMAIL` and `STREAM_KEEPR_ACCEPTANCE_OPERATOR_PASSWORD` name the operator, at the `accounts` host of the Installation's Keepr domain unless `STREAM_KEEPR_ACCEPTANCE_ACCOUNTS_ORIGIN` names another.

**The deploy tooling's build step starts the Accounts Stand-in** for an app whose source Wrangler configuration binds Keepr Accounts, around each of the descriptor's build scripts, for the deploy and CI alike. CI's own wrapper around `keepr-deploy check` is gone. Stream Keepr now binds `keepr-accounts` in both Environments, so deploy order (ADR-0120) refuses its deploy to an Environment whose Keepr Accounts is behind.

The rules these set are in `RULES.md`, under Identity and access and under Access.

### Why

- **One identity, and no second sign-in to keep safe.** A person who used Stream Keepr held an account Keepr Accounts knew nothing of. Removing it removes a second set of credentials, a second rate limiter and cookie policy to state and test (ADR-0012), and a bootstrap route that answered to a shared secret.
- **A name that skips sign-in cannot be set if nothing reads one.** ADR-0017 accepted that the bypass name on a deployed Worker turns the bypass on. Now what admits a request locally is a separate Worker, never deployed, and a deployed App can only reach the real Keepr Accounts (ADR-0113).
- **The no-access refusal is the layer's, so it is the same in every App.** A literal in the boundary would be a second wording to keep equal to the layer's. The route refusal scan does not read the layer, and does not need to: the refusal is not Stream Keepr's to rename.
- **The boundary's 401 stays a literal.** It is composed around every route, and the scan reads a status and message only within the file it is reading (ADR-0010).
- **`optionalIdentity` cannot admit anyone.** It only turns a refusal into "no Session", for routes that then refuse in their own words. A Screen Output with a capability is admitted before Keepr Accounts is asked anything, so an outage there never takes program off air.
- **The stand-in's cookie adds no authority.** The stand-in already answers anyone who reaches it as a User with full authority, and it is never deployed. Whole-server tests need a signed-out visitor, a User with no App access, a User without `admin`, a second User and a second Session, and the acceptance asks for them on the built Worker against the stand-in. Reading a cookie is how Keepr Accounts itself tells callers apart, so the App runs the code it runs in production.
- **A registry per run, not per machine.** Wrangler keeps the first of two Workers registered under one name. One machine-wide registry would hand a second worktree's dev server the first one's stand-in and realtime Worker. Starting the command only after the stand-in registers means its first request is never refused for a Worker still starting.
- **The holder's name is kept with the lease because a lease is short.** It lasts minutes and is overwritten by the next holder, so a rename in between does not matter. The Evidence Ledger lasts a year and is not given the same answer: a name written beside an entry would be what ADR-0010 refused.
- **The tables go in the same Release.** Nothing reads them, there are no Users to carry, and a table of credentials nothing guards is not worth keeping for a later migration.

### What this changes

- **ADR-0017** is superseded: there is no bypass name, launcher or scan. ADR-0113 said this work would do so.
- **ADR-0010**: Better Auth, the admin add-on, admin-created accounts, the Password Reset Link, the secret-armed bootstrap and the `/api/auth/**` and `/api/bootstrap/ensure-admin` exemptions no longer describe Stream Keepr. Its deny-by-default boundary, its cross-site refusal, its literal 401, the Screen Output routes' 404, per-User operation ownership and the Session as a lease's holder all stand, on Keepr Accounts' User and Session. "Display name resolved at read time" holds for the reader alone.
- **ADR-0012**: the census and its four tripwires leave Stream Keepr with its Better Auth. Keepr Accounts keeps its own (ADR-0112).
- **ADR-0018**: the accepted LAN exposure is `pnpm dev:local`'s. `dev:local:bypass` is gone, and `AUTH_ALLOWED_HOSTS` with it.
- **ADR-0113**: an App now runs the stand-in, which answers as whoever its cookie names and keeps a registry per run. Its guard has run on every deploy since ADR-0119.
- **ADR-0121**: the stand-in a binding app's Worker leg runs against is started by the tooling's build step, in a deploy's build as in CI. It is still never deployed.
- **ADR-0131**: the role is read from the Identity Proof, not from a User row; the 403 is the layer's; the bootstrap no longer grants the role, because App access is granted in Keepr Accounts.

### Rejected alternatives

- **A stand-in that mints a cookie per browser**, so each local browser is its own Session. The layer caches an Identity Proof by the request's cookies, so browsers with no cookie yet would share one cached Session and change Session as the cache refreshed.
- **One stand-in for the whole integration suite.** Every server would inherit its registry, and each server's realtime dev Worker would register under one name in it.
- **A literal 403 for no App access in the boundary.** See Why: the refusal must be the same in every App.
- **Keeping a local table of Users**, to name every actor. It would be a second copy of names and addresses that only Keepr Accounts holds (ADR-0112), decided as a side effect of removing sign-in. It is one of the two ways to name other Users, and is left to that work.
- **Keeping the auth tables for a later Release.** The owner decided on one Release. See Why.
- **A build-time or environment switch that admits requests locally.** ADR-0113 already refused it: a switch inside a build is a switch a deployment can carry.
