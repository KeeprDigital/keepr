# Shared layer rules

What each of the layer's named modules must do. What each term is, is in the root `GLOSSARY.md` (ADR-0095). Decisions cited as ADR-NNNN are files in `docs/adr` here; ADR-0078 is in `apps/stream/docs/adr`, from the repository's root.

## Terms

**Clock Projection**:
Every rendering of one computes the same answer, and nothing writes as it runs. One scheduler, `useClockProjection`, answers each anew exactly when it next changes, when an input it reads changes, and when server time re-syncs or first becomes known; it runs on the client only, and its wait ends with the scope that owns it (ADR-0088). Each caller states what it shows while server time is unknown, an answer of its own or the device's time, and one on the device's time is taken again the moment the first sync lands (ADR-0088). A countdown shows its time remaining rounded up to the whole second, so it reads its full duration as it starts and `0:00` only from its end; elapsed and count-up time round down (ADR-0078).

Server time is read from `GET /api/time`, which every app that shows it serves with `readServerTime`, reachable without a sign-in: the layer registers no route (ADR-0093). It never stops or moves backwards: a sync takes its sample with the shortest round trip, the first sync and a correction over 500 ms apply at once, and a smaller one is eased in at no more than a tenth of elapsed time. It re-syncs every minute, when its page becomes visible or comes back online, and within seconds of its device's clock being changed (ADR-0088).

**Interval**:
Before its anchor it stands at its first period, which ends one period after the anchor. One with no period never steps.

**Frame Clock**:
It reads its instant again on every animation frame only while anything read at it is in motion, and schedules no frame once all of it has settled; its owner starts it again when what it reads changes. It runs on the client only, and stops with the scope that owns it (ADR-0088).

**App registry**:
App access is assigned only as an App the registry names and an App role that App defines in it. Adding an App or an App role changes the registry, never the identity schema (ADR-0112, in the root `docs/adr`).
