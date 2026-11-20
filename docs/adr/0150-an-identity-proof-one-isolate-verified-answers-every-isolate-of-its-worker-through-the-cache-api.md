# ADR-0150: An Identity Proof one isolate verified answers every isolate of its Worker, through the Cache API

Accepted · 2026-11-20 · [#1375](https://github.com/KeeprDigital/keepr/issues/1375) · Amends ADR-0113 · Amended by ADR-0158: Keepr Accounts' keys are shared for an Identity Proof's lifetime, not an hour

ADR-0113 has an App cache each Identity Proof, and the layer's resolver did so in its isolate. Cloudflare spreads a Worker's requests over several isolates, and refreshes a proof only when a request reaches the isolate holding it. On Staging (#1363), at one write every 30 s, an isolate that served nothing for five minutes held an expired proof, and its next write waited 230 to 380 ms on Keepr Accounts: about one Take in thirty was up to half a second late on air. A fresh isolate also fetched Keepr Accounts' keys first.

### Decision

**What a resolver verifies, it shares with every isolate of its Worker**, through a shared store it is given (`SharedStore`, `packages/nuxt-layer/server/utils/sharedIdentityStore.ts`). By default that is the Worker's Cache API, in a named cache of its own (`keepr-identity`), not `caches.default`: per data centre, with no binding, on an Installation's custom domain and in local `workerd`. Where there is no Cache API, as under Node, there is no store, and the resolver works alone as before.

**Records are kept under the origin the Worker was reached on**: the Installation's own, read from the URL of the request Cloudflare routed to the Worker (`event.context.cloudflare.request`, as Nitro hands it on), never from a header a client sets, such as `X-Forwarded-Host`. A record's URL is that origin with the record's hashed path after it, so the origin only places a record and never decides which Session it answers: records under one origin are not read under another, and a request with no origin, as outside a Worker, shares nothing.

**What is shared is the token Keepr Accounts signed**, never what it was read as. An isolate that finds one verifies it as it verifies one Keepr Accounts has just answered, issuer, audience, key, algorithm and expiry, before it answers from it. One that does not verify answers nobody, and the next ask replaces it.

**A Session's record is kept under a SHA-256 hash of the request's cookie**, never the cookie, and **sealed with AES-GCM** under a second hash of the same cookie, bound to the key it is kept under. It opens only for a request carrying the cookie it was written for. The cookie, and the renewed cookies a record may hold, are never in the store in the clear. It is kept no longer than the proof's expiry.

**The isolate's own copy answers first.** The store is read only when that is missing or expired, and when the isolate's copy is half way through its life, before it asks: a newer proof another isolate already refreshed answers instead of a second ask. Past a proof's expiry no isolate answers from it, so a removed User or a changed role takes effect no later than before.

**A refresh that Keepr Accounts answers 401 removes the shared record**, as it removes the isolate's own.

**Cookies a refresh renewed are shared with the proof**, and reach the browser through whichever isolate answers it next. That isolate drops them from the shared record, and an isolate that finds them gone sends none. With no record to ask, an isolate sends them: twice is harmless, never is not.

**Keepr Accounts' keys are shared for an hour**, so a fresh isolate verifies without fetching them. A proof signed by a key they do not hold still has them fetched again, once, and the fetch is shared.

**A store that fails, or does not answer within 100 ms, is done without**, and its failure logged (`identity_store_failed`). The resolver then answers from its own copy or asks, as it would alone, and never refuses because of the store. A shared record that does not verify, other than an expired one, is logged too (`identity_store_refused`).

The rules these set are in the layer's `RULES.md`, under Identity Proof.

### Why

- **One isolate's ask answers the others.** The cost #1363 measured was each isolate asking for itself. Shared, an expired proof in a quiet isolate is replaced by the one a busy isolate refreshed, and only the first write after a deploy, in each data centre, waits on Keepr Accounts.
- **The Cache API needs no binding.** Workers KV or a Durable Object would be a binding every App adds to its Wrangler configuration, which ADR-0138 puts in a layer the App chooses. A cache entry that is lost costs one ask, which is what every miss cost before, so its being per data centre and evictable is enough.
- **Sharing the signed token keeps Keepr Accounts the only source.** A record re-verified on every read can only hold what Keepr Accounts signed, for as long as it signed it for. Sharing the identity read from it would make the store a second authority.
- **The seal binds a record to its cookie.** A record under one Session's key cannot be read, or answered from, by a request with another's cookie, even if moved; and the renewed cookies a record carries are a credential that should not rest in a cache in the clear.
- **A refresh looks before it asks**, so a proof's refresh is asked once for all the isolates that hold it, rather than once by each.
- **An hour for keys.** A fresh isolate would otherwise fetch them on a write. A withdrawn key stops being trusted by a fresh isolate within the hour; an isolate already holding it, as before, until it is rotated.

### What this changes

- **ADR-0113**: "an App caches each Identity Proof" is now across the Worker's isolates, not in each. Its bounds are unchanged: an App keeps answering for up to five minutes while Keepr Accounts is unreachable, and an ended Session or a disabled User stops resolving within the same five minutes.

### Rejected alternatives

- **Workers KV.** Global, but a binding per App, and eventually consistent for up to a minute, so a 401's removal could be read back stale in another data centre.
- **A Durable Object per Worker.** Consistent, but every miss becomes a call to one object in one place, which is the kind of round trip this removes.
- **Sharing the decoded identity.** Faster to read, but anything that could write the store could then grant any identity: the store would have to be trusted as Keepr Accounts is.
- **Keeping renewed cookies in the refreshing isolate only**, as before. The browser's next request may reach another isolate that answers from the shared proof, and the renewal would reach it late or never.
- **A secret of the App's to sign or seal records.** It would add an operator step to every deploy for nothing more: whoever can write a Worker's cache can deploy code to its account.
