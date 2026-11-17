# ADR-0112: One Keepr identity, held by Keepr Accounts, which alone opens the identity database

Accepted · 2026-11-17 · #1228, #1248 · Amends ADR-0010, ADR-0012 and ADR-0093

### Decision

**A person has one User across every Keepr App, held by Keepr Accounts** (`apps/accounts`, `@keepr/accounts`), a Nuxt app on the shared layer deployed as its own Worker, `keepr-accounts`, at `accounts.keepr.digital`. It is not an App: nobody is granted access to it.

**Keepr Accounts alone opens the identity database, holds the sign-in secret and runs Better Auth.** An App learns who a request belongs to from an Identity Proof that Keepr Accounts signs and the App verifies for itself (ADR-0113).

**Its Better Auth is the version the workspace pins**, with sign-up closed, the admin add-on (a Keepr Administrator is its `admin` role, a disabled User its ban), the organisation add-on, the signed-token add-on and the breached-password check. The schema is written by hand and held to the library's own table definitions by a test, beside three tables of Keepr Accounts' own.

**The session cookie's domain follows the host Keepr Accounts is served on**, not the kind of build.

**The library's administrator routes are closed.** Keepr Accounts serves narrower routes of its own.

**The Return Address is Keepr Accounts' own rule**, applied by its sign-in page; the library is never handed one.

**What an App can be granted is declared in the App registry, in the shared layer** (`packages/nuxt-layer/shared/utils/appRegistry.ts`).

The rules these set are in `apps/accounts/RULES.md`, under Identity, User, Session and Return Address, and in the layer's `RULES.md`, under App registry.

### Why

- **Running Better Auth in several Workers over one database is not a setup the library documents.** One server, with Apps verifying a signed statement, needs nothing undocumented, and an App keeps working for the minutes an Identity Proof lasts if Keepr Accounts is unreachable.
- **The cookie domain follows the host, not the kind of build.** A browser refuses a cookie for `keepr.digital` set from `localhost`, and real sign-in locally means running the built Keepr Accounts beside an App (#1228 § Development). Keyed on `import.meta.dev`, as Stream Keepr's secure-cookie choice is, a local built run would set a cookie no browser keeps. Keyed on the host, production always shares the cookie and a local run never tries.
- **The origin check trusts Keepr Accounts' own hosts only.** Better Auth checks a sign-in's return address against the same list it checks a write's `Origin` against. Listing every Keepr host to admit return addresses would let a page on any of them, the public site included, make writes here.
- **Stream Keepr's census holds here.** The tests run under `NODE_ENV=test`, so each environment-dependent option is stated rather than inherited (ADR-0012), with a tripwire in `apps/accounts/test/unit/server/authTripwires.sqlite.test.ts`. The rate limiter counts in the database, so every isolate shares one count per client.
- **The signed-token add-on is installed with the schema**, because its key table is part of it; ADR-0113 builds the Identity Proof on its routes.
- **The SQLite D1 harness moves into the layer** (`packages/nuxt-layer/test/helpers/sqlite-d1.ts`). Keepr Accounts is the second app whose server is tested over its real migrations, and what a second app needs moves there (ADR-0093). It takes drizzle's D1 type, so the layer needs no Worker types.

### What this changes

- **ADR-0010**: single-tenant accounts, the host-only cookie, the admin-created account and the secret-armed bootstrap endpoint no longer describe Keepr's identity. They still describe Stream Keepr's own sign-in until it moves onto Keepr Accounts, which is separate work.
- **ADR-0012**: the census and its tripwires apply to Better Auth wherever it runs; Keepr Accounts has its own, and they leave Stream Keepr with its sign-in.
- **ADR-0093**: sign-in is no longer only Stream Keepr's own: the layer holds the App registry, and will hold the code an App relies on Keepr Accounts with. The D1 harness, which it kept in the app for its Worker types, is in the layer.

### Rejected alternatives

- **Each App keeps its own users.** Every new App would repeat accounts, and a person using two would hold two.
- **Apps share the identity database.** Every App would hold the sign-in secret and run Better Auth against one database, the setup the library does not document.
- **The cookie domain from `import.meta.dev`.** See Why: a local built run would set a cookie the browser drops.
- **Every Keepr host as a trusted origin, so Better Auth checks the return address.** See Why: it opens Keepr Accounts' writes to every Keepr host.
