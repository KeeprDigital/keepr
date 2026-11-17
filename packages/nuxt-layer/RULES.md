# Shared layer rules

What each of the layer's named modules must do. What each term is, is in the root `GLOSSARY.md` (ADR-0095). Decisions cited as ADR-NNNN are files in `docs/adr` here; ADR-0078 is in `apps/stream/docs/adr`, and ADR-0112 and ADR-0113 in the root `docs/adr`, from the repository's root.

## Terms

**Clock Projection**:
Every rendering of one computes the same answer, and nothing writes as it runs. One scheduler, `useClockProjection`, answers each anew exactly when it next changes, when an input it reads changes, and when server time re-syncs or first becomes known; it runs on the client only, and its wait ends with the scope that owns it (ADR-0088). Each caller states what it shows while server time is unknown, an answer of its own or the device's time, and one on the device's time is taken again the moment the first sync lands (ADR-0088). A countdown shows its time remaining rounded up to the whole second, so it reads its full duration as it starts and `0:00` only from its end; elapsed and count-up time round down (ADR-0078).

Server time is read from `GET /api/time`, which every app that shows it serves with `readServerTime`, reachable without a sign-in: the layer registers no route (ADR-0093). It never stops or moves backwards: a sync takes its sample with the shortest round trip, the first sync and a correction over 500 ms apply at once, and a smaller one is eased in at no more than a tenth of elapsed time. It re-syncs every minute, when its page becomes visible or comes back online, and within seconds of its device's clock being changed (ADR-0088).

**Interval**:
Before its anchor it stands at its first period, which ends one period after the anchor. One with no period never steps.

**Frame Clock**:
It reads its instant again on every animation frame only while anything read at it is in motion, and schedules no frame once all of it has settled; its owner starts it again when what it reads changes. It runs on the client only, and stops with the scope that owns it (ADR-0088).

**App registry**:
App access is assigned only as an App the registry names and an App role that App defines in it. Adding an App or an App role changes the registry, never the identity schema (ADR-0112, in the root `docs/adr`). Each App lists its roles from lowest to highest, and a role admits what every role before it does (ADR-0113).

**Identity Proof**:
An App reads who a request belongs to only from an Identity Proof, through `resolveRequestIdentity`: asked of Keepr Accounts over the `KEEPR_ACCOUNTS` binding, with the request's cookie, and verified against Keepr Accounts' published keys, for issuer `https://accounts.keepr.digital`, audience `https://keepr.digital` and EdDSA only. A proof signed by a key not yet read has the keys fetched again once. An App role the registry does not define for the App is no App access (ADR-0113).

A verified proof answers until it expires; once half its life has passed it is refreshed in the background, and it keeps answering while Keepr Accounts is unreachable. Past expiry only a fresh answer admits the request: a signed-out visitor is refused 401, and an unreachable Keepr Accounts or an unverifiable proof 503, naming why, and naming the Accounts Stand-in when nothing is registered locally as `keepr-accounts`. A refresh that hears 401 drops the proof at once. Every cookie Keepr Accounts sets is passed on to the browser (ADR-0113).

`requireAppAccess` refuses an Identity with no App access, and `requireAppRole` one below the role required, each 403 with a code, in every App alike; a Keepr Administrator is held to them like anyone else. `useIdentity` sends a signed-out visitor to Keepr Accounts' sign-in with the page they were on as the Return Address, and leaves any other refusal to its caller (ADR-0113).
