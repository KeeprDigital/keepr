# ADR-0158: An App's question to Keepr Accounts cannot be starved, forged or over-shared

Accepted · 2026-11-20 · [#1386](https://github.com/KeeprDigital/keepr/issues/1386) · Amends ADR-0113, ADR-0141, ADR-0150

The 2026-11-20 codebase review found that an App's question to Keepr Accounts ("who is this?") could be starved by a stranger, kept trusting keys Keepr Accounts had withdrawn, and shared more than it had to. An App asks over its `KEEPR_ACCOUNTS` service binding, and a binding's request carries no client address. Keepr Accounts' rate limiter keys on the address Cloudflare writes (`cf-connecting-ip`) and, finding none, counts every such caller in one bucket, 100 per ten seconds. About ten anonymous requests a second to any private App route kept it exhausted, and every User whose five-minute Identity Proof lapsed was refused 503 in every App.

### Decision

**Keepr Accounts does not count an App's questions.** Its Identity Proof and key routes (`/api/auth/token`, `/api/auth/jwks`) are left out of the rate limit for a request that carries no client address. Cloudflare writes the address on every request from the internet, so a request without one came over a binding; a browser asking directly is counted by its address as before.

**An App asks nothing for a request with no Keepr Accounts cookie**: it is signed out, and Keepr Accounts never hears of it.

**An App remembers a signed-out answer for 30 seconds**, under the cookies it was given, so a stranger repeating one cookie asks Keepr Accounts once. A sign-in brings a new cookie, so nothing waits on it.

**An App sends Keepr Accounts only Keepr Accounts' own cookies**: the library's, `better-auth.*` under either prefix, and locally the Accounts Stand-in's `keepr-stand-in`. Only those tell one Session from another in its cache.

**An App asks its own Environment's Keepr Accounts**: `accounts.` on the Keepr domain the App was reached under, production's otherwise. The renewed session cookie Keepr Accounts sets follows the host it is asked on, so in Staging it is set on `keepr-staging.digital` and reaches the browser. The issuer every proof names stays production's.

**Keepr Accounts' keys are trusted for an Identity Proof's lifetime, five minutes**, in an isolate and in the shared store, so a key Keepr Accounts withdraws stops verifying within the time a revocation takes. A fresh answer from Keepr Accounts renews keys past half that, as a proof is refreshed, so the keys other isolates read stay as fresh as the proof they share; if Keepr Accounts cannot answer then, the keys still within their lifetime serve. An ask Keepr Accounts leaves unanswered for five seconds is given up, so a refresh that never returns is tried again.

**A caller is told one sentence when no Identity Proof can be trusted**: "Keepr Accounts could not be asked who you are. Try again in a moment." Why (the verification error, the status upstream, how to start the Accounts Stand-in) goes to the log.

**"Who am I" (`IDENTITY_PATH`) answers the User and their App role**, not the Session, the Organisation or whether the User is a Keepr Administrator: the server is all that decides with those.

**No App's Worker carries the Accounts Stand-in.** Its Worker already answers only where its launcher started it (ADR-0154); its key ids also carry a mark of their own, and Stream Keepr's `worker:dry-run` refuses a built Worker that holds it. A persona can name its Organisation, Organisation role and whether it is a Keepr Administrator.

**A local browser signs in at the Accounts Stand-in, with no password.** A request with no cookie is no longer the Local Developer User: it is signed out like any other, and the page gate sends the browser to Keepr Accounts' sign-in. Beside the stand-in, that is the stand-in's own `/sign-in`, on a port its launcher picks free and names to the command as `NUXT_PUBLIC_KEEPR_ACCOUNTS_ORIGIN` unless one is named already (`pnpm preview` passes it to the built Worker as a var). It sets `keepr-stand-in` with no fields, the Local Developer User, and sends the browser back to `returnTo`, only ever a page on this machine (`localhost` or `127.0.0.1`, where it listens); a browser returning to another of those hosts is sent to the sign-in on that host first, as a cookie is kept per host. A script or test asks as the Local Developer User with that cookie (`LOCAL_DEVELOPER_COOKIE`).

### Why

- **Exempting binding callers rather than forwarding the browser's address.** Whether a deployed binding call carries an address is to be confirmed on Staging (#1383). An address the App forwarded would need Keepr Accounts to trust it only from a binding, which it cannot tell apart except by the absence of Cloudflare's header; that absence is the exemption itself, with nothing for a caller to write.
- **The proof is the expensive question, and a stranger's is answered alike.** Caching a signed-out answer bounds what a stranger's repeated cookie costs, as a cached proof bounds a User's.
- **A cookie Keepr Accounts does not read is the App's own business**, and another App's on the shared Keepr domain is not the App's to pass on.
- **A key is withdrawn because it should no longer be trusted.** An hour's cache kept trusting one for an hour.
- **A 503 that named the reason told every caller about the Installation.** The operator reads the log.
- **A request with no cookie is the cheapest stranger, and Keepr Accounts can only say no to it.** Asking cost a binding call each time.
- **The stand-in signs in as Keepr Accounts does, so nothing in an App changes for it.** The page gate's 401-to-sign-in flow is the production one; what differs locally is which Worker answers it, as ADR-0113 has it. Nothing is added to an App, a build or a request that admits anyone without an Identity Proof (ADR-0141): the stand-in's sign-in exists only where its launcher runs it, and returns only to this machine.

### What this changes

- **ADR-0141**: "a request with no `keepr-stand-in` cookie is still the Local Developer User" no longer holds; a browser gets that cookie from the stand-in's sign-in. Under `pnpm dev:local`, another machine on the network is not returned to by the sign-in and sets the cookie by hand, so ADR-0018's accepted exposure stands.
