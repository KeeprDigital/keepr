# ADR-0113: No shipped build can skip sign-in, and local work is served by the Accounts Stand-in

Accepted · 2026-11-17 · #1228, #1254 · Amends ADR-0017

### Decision

**An App learns who a request belongs to only from an Identity Proof**, which it asks of Keepr Accounts over its `KEEPR_ACCOUNTS` service binding to `keepr-accounts` and verifies itself, with the layer's `resolveRequestIdentity` (`packages/nuxt-layer/server/utils/requestIdentity.ts`). Nothing in an App, the layer or a build can say "skip this": no setting, variable or build flag admits a request without a proof that verifies.

**The Identity Proof is the signed-token add-on's token**, minted by Keepr Accounts from the session cookie, with an issuer and audience fixed for every App rather than read from a request.

**An App caches each Identity Proof**, and keeps answering from it while Keepr Accounts is unreachable, until it expires. The layer's `requireAppAccess` and `requireAppRole` refuse alike in every App.

**Local work is served by the Accounts Stand-in** (`packages/accounts-stand-in`), a Worker registered locally under `keepr-accounts`, so an App's configuration is the same whether the stand-in, the real Keepr Accounts or production answers it. It answers as the Local Developer User with full authority, and signs with the production issuer and audience and a key of its own.

**An App that adopts Keepr Accounts starts the stand-in from its development setup**: its `dev` script runs the App through `keepr-accounts-stand-in -- <command>`, and so do its previews, its Worker smoke run and its integration and acceptance suites, each of which runs a whole server with no real Keepr Accounts beside it. Its unit and Nuxt-environment tests start no Worker. No App runs it yet: Stream Keepr moves onto Keepr Accounts in separate work, and wires the stand-in in as it does.

**The Accounts Stand-in cannot be deployed.** It has no deploy script, its configuration is a file Wrangler does not find by itself, and its package carries the mark `keepr.undeployable`, which `keepr-deploy-guard` in `@keepr/tooling` refuses. No deploy runs the guard yet: per-app deploy (#1258) runs it on each configuration before uploading it.

**Assuming an identity is deferred.** Nothing lets a User act as another, locally or deployed. When it is built it is a decision of its own, held to these constraints: only a Keepr Administrator may start it; each start and end is in the Audit Record; it is time-limited; and the Identity Proof carries an `act` claim naming who is really acting, so an App can show it and keep it in its own records. The library's impersonation route stays closed (ADR-0112).

The rules these set are in `apps/accounts/RULES.md` and the layer's `RULES.md`, each under Identity Proof, and how to run the stand-in is in its `README.md`.

### Why

- **A switch inside a build is a switch a deployment can carry.** ADR-0017 kept Stream Keepr's bypass out of every file, and accepted that setting the name on a deployed Worker turns it on. Here there is no name to set: what admits a request locally is a separate Worker, and a deployed App can only reach the real Keepr Accounts.
- **One verifier, no development branch.** The stand-in signs what Keepr Accounts signs, for the same issuer and audience. Locally, the App runs exactly the code it runs in production, and the only difference is which Worker answers its binding.
- **Full authority by default.** Local work most often needs everything, and the owner asked for it: Keepr Administrator, Organisation owner, the highest role in every App. Seeing the App as someone with less needs the real Keepr Accounts beside it until assuming an identity is built.
- **A fixed Organisation is enough** while Organisation data separation inside the Apps is out of scope (#1228). A local setting or an assumed identity can choose it once there is more than one.
- **The cache bounds both failures.** An App keeps working for up to five minutes if Keepr Accounts is unreachable, and a disabled User or ended Session stops resolving within the same five minutes.
- **Spike 1 measured the dev registry's 503** when nothing is registered (#1256). Left alone, it reads as a broken App; named, it says what to start.
- **The guard reads a mark, not a name.** `keepr-accounts` is also the real Keepr Accounts' name, so refusing the name would refuse the real deploy. The mark is on the package, so a built configuration copied elsewhere in it is still refused, and the tooling knows no app.
- **The layer's identity function is tested in `apps/accounts`**, against the real minting: the layer cannot import an app, and a stand-in issuer there would prove only that two fakes agree. The layer's own tests cover how a route meets it. This conflicts with the layer's rule that a rule's tests live with the rule; the layer's `README.md` records it as the one exception.

### What this changes

- **ADR-0017**: the Local Developer Session behind `STREAM_KEEPR_LOCAL_AUTH_BYPASS` is replaced, for every App on Keepr Accounts, by the Accounts Stand-in. It still describes Stream Keepr's own sign-in until Stream Keepr moves onto Keepr Accounts, which supersedes it. Contradicts ADR-0017 for Apps on Keepr Accounts, worth reopening because its residual, a deployed Worker that serves unauthenticated once a name is set on it, was accepted by capability equivalence; here there is no such name, so nothing needs accepting.

### Rejected alternatives

- **An in-process stand-in compiled out of production.** Spike 1 showed the separate Worker works under `nuxt dev` and the built Worker alike, and a separate Worker is never in an App's bundle to compile out.
- **A development branch in the verifier**, accepting another issuer or audience locally. The branch would ship in every build.
- **A stand-in key committed to the repository.** Anyone could sign with it; a key made per run is never shared.
- **Refusing to deploy any Worker named `keepr-accounts` but Keepr Accounts' build.** It would teach the tooling an app's path. See Why.
- **Assuming an identity now.** It is a deliberate, visible act only when designed as one; scoped out until then.
