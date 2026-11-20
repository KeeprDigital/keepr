# ADR-0163: A Screen Output's reads and an Event Data change cost what is shown, not what is held

Accepted · 2026-11-20 · [#1380](https://github.com/KeeprDigital/stream-keepr/issues/1380)

### Decision

**A Standings Screen Output's read answers only the rows its range shows, and of each only what its visible columns show** (`shared/utils/standingsRows.ts`, `standings.get.ts`). It carries no Player field its rendering has no use for, so a capability reader is told nothing it does not show. Which of a reveal's rows are revealed is the rendering's own (`useStandingsModeData`), so stepping a reveal never waits on a read.

**A write announcing many Event Data changes is one change** (`asOneEventDataChange`, `event-data-publication`). Each message is published as it is announced; each Screen is told once and each Event's Graphic Input Bindings re-resolve once, after the write's announcements settle. Every write that releases or repoints Screens announces them so, and an Event's settings save announces its Slots so.

**An Event's settings save corrects its Feature Match Sessions in round trips that do not grow with its Slots** (`correctSessionSnapshots`, `executeMinted`): one read of the Sessions, one of their Players and one batch of every correction. A Session that moved on meanwhile is corrected again alone.

### Why

A Standings read returned every Player of the Event with every field, for a Screen showing eight rows of three columns, to an unauthenticated capability reader that had no use for the rest. A 50-Slot Event's settings save corrected and announced Slot by Slot, re-resolving bindings and telling Screens per Slot inside its request: hundreds of sequential queries before the operator saw it saved.

### Consequences

- A Standings rendering re-reads when its range or columns change, since its read carries no more than it shows.
- What a write announced before it failed is still told to Screens and bindings, since it announced a committed write.
- A failed correction batch fails the whole save's corrections together; the caller recovers each Slot alone.
