# Shared layer rules

What each of the layer's named modules must do. What each term is, is in the root `GLOSSARY.md` (ADR-0095). Decisions cited as ADR-NNNN are files in `docs/adr` here; ADR-0010 and ADR-0078 are in `apps/stream/docs/adr`, and ADR-0112, ADR-0113, ADR-0145 and ADR-0150 in the root `docs/adr`, from the repository's root.

## Terms

**Clock Projection**:
Every rendering of one computes the same answer, and nothing writes as it runs. One scheduler, `useClockProjection`, answers each anew exactly when it next changes, when an input it reads changes, and when server time re-syncs or first becomes known; it runs on the client only, and its wait ends with the scope that owns it (ADR-0088). Each caller states what it shows while server time is unknown, an answer of its own or the device's time, and one on the device's time is taken again the moment the first sync lands (ADR-0088). A countdown shows its time remaining rounded up to the whole second, so it reads its full duration as it starts and `0:00` only from its end; elapsed and count-up time round down (ADR-0078).

Server time is read from `GET /api/time`, which every app that shows it serves with `readServerTime`, reachable without a sign-in: the layer registers no route (ADR-0093). It never stops or moves backwards: a sync takes its sample with the shortest round trip, the first sync and a correction over 500 ms apply at once, and a smaller one is eased in at no more than a tenth of elapsed time. It re-syncs every minute, when its page becomes visible or comes back online, and within seconds of its device's clock being changed (ADR-0088).

**Release identity**:
Every app serves it at `GET /api/release` with `readReleaseIdentity`, reachable without a sign-in, as `{ app, version, commit }`: the app's package name without `@keepr/`, its version (`unversioned` when Changesets does not version it), and the commit built, `unknown` where git cannot read it. The build records it in runtime config; a Worker without one refuses rather than answering part of one (ADR-0119, in the root `docs/adr`).

**Interval**:
Before its anchor it stands at its first period, which ends one period after the anchor. One with no period never steps.

**Frame Clock**:
It reads its instant again on every animation frame only while anything read at it is in motion, and schedules no frame once all of it has settled; its owner starts it again when what it reads changes. It runs on the client only, and stops with the scope that owns it (ADR-0088).

**App registry**:
App access is assigned only as an App the registry names and an App role that App defines in it. Adding an App or an App role changes the registry, never the identity schema (ADR-0112, in the root `docs/adr`). Each App lists its roles from lowest to highest, and a role admits what every role before it does (ADR-0113).

**Identity Proof**:
An App reads who a request belongs to only from an Identity Proof, through `resolveRequestIdentity`: asked of Keepr Accounts over the `KEEPR_ACCOUNTS` binding, with the request's cookie, and verified against Keepr Accounts' published keys, for issuer `https://accounts.keepr.digital`, audience `https://keepr.digital` and EdDSA only. A proof signed by a key not yet read has the keys fetched again once. An App role the registry does not define for the App is no App access (ADR-0113).

A verified proof answers until it expires; once half its life has passed it is refreshed in the background, and it keeps answering while Keepr Accounts is unreachable. Past expiry only a fresh answer admits the request: a signed-out visitor is refused 401, and an unreachable Keepr Accounts or an unverifiable proof 503, naming why, and naming the Accounts Stand-in when nothing is registered locally as `keepr-accounts`. A refresh that hears 401 drops the proof at once. Every cookie Keepr Accounts sets is passed on to the browser (ADR-0113).

What a resolver verifies, it shares with every isolate of its Worker, through the Worker's Cache API in its data centre, under the origin the Worker was reached on, as Cloudflare routed the request and never as a header names it. Records under one origin are not read under another, and a request with no origin shares nothing (ADR-0150). It shares the Identity Proof as Keepr Accounts signed it, and each isolate verifies it again, issuer, audience, key and expiry, before answering from it; it never shares what it read the proof as. A Session's proof is kept under a SHA-256 hash of the request's cookie, never the cookie, and sealed with a key only that cookie derives, so it opens for no other. The isolate's own copy answers first, and the shared one is read only when that is missing or expired, and before a refresh, which another isolate's newer proof answers instead. A refresh that hears 401 removes the shared proof too. Cookies a refresh renewed are shared with the proof and reach the browser through whichever isolate answers it next, once. Keepr Accounts' keys are shared for an hour, and a proof signed by a key not among them still has them fetched again. A shared store that fails, or does not answer within 100 ms, is done without: the resolver then works as it would alone, and never refuses for it (ADR-0150).

`requireAppAccess` refuses an Identity with no App access, and `requireAppRole` one below the role required, each 403 with a code, in every App alike; a Keepr Administrator is held to them like anyone else. `useIdentity` sends a signed-out visitor to Keepr Accounts' sign-in with the page they were on as the Return Address, and leaves any other refusal to its caller (ADR-0113).

**User**:
An App holds no Users. It names the User a request belongs to from their Identity Proof, and learns what to call any other from Keepr Accounts, through `readUserNames`: asked over the `KEEPR_ACCOUNTS` binding at `GET /api/users/names`, with the request's own cookie and no credential of the App's, in questions of at most 50 ids. Keepr Accounts decides whose names that Session is told; an id it leaves out is unnamed, and the App shows the id (ADR-0145).

It never refuses a reading. While Keepr Accounts fails, refuses, does not answer within two seconds, or answers anything but names, as a Release with no such route answers its page, the ids asked about come back unnamed, and the next reading asks again. A name not text, blank, or for an id not asked about is ignored (ADR-0145).

What Keepr Accounts answered is kept for five minutes, an Identity Proof's life, under the cookie it was given to, a User it left unnamed included, and never longer while Keepr Accounts cannot be asked. So a name reaches only a request Keepr Accounts gave it to, and a User who stops sharing an Organisation with a reader stops being named to them within five minutes (ADR-0145).

## Server

**Cross-site write check** (`requestIsCrossSiteMutation`):
A safe method, `GET`, `HEAD` or `OPTIONS`, is never flagged. Otherwise `Sec-Fetch-Site`, where sent, decides alone: `same-origin` and `none` pass and anything else is flagged. Without it, an `Origin` must name the host the request was addressed to, its scheme not compared; `null`, or one that does not parse, is flagged. A request with neither header passes. An app refuses a flagged request 403 on every Session-authenticated write, from its own route or middleware (ADR-0010).
