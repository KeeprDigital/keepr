# ADR-0009: The current page of a Page Rotation is a clock projection, not persisted state

Accepted · 2026-08-12 · [#312](https://github.com/KeeprDigital/stream-keepr/issues/312)

### Decision

The current page of a paginated Screen Mode (standings, metagame, most played cards, player history, pairings, archetype spotlight) is a **pure projection of (Rotation Anchor, page duration, page count, server time)**, computed identically by every rendering — Screen Output, Program Monitor, operator settings — from one shared function in `shared/modules/page-rotation/`. Nothing writes as the rotation runs; a rendering re-evaluates exactly at each flip boundary.

- **Only operator surfaces write `rotationAnchor`**, on three occasions: enabling auto-page; an edit that changes the rotation's shape (page duration, page size, a display reset restoring them; decided once by `pageRotationEdit`, ADR-0039); and a manual page selection while rotating, written so the chosen page is current for one full duration. It rides the existing config write and `screen:updated` announcement.
- **A missing anchor projects from epoch zero**, still deterministic, so older configs rotate without migration.
- **An unsynced rendering shows the first page statically** — never project on an unknown clock. With auto-page off, the persisted `currentPage` is the manually selected page.

### Why

Every rendering used to run a timer that persisted the next page. A freshly opened output could not persist at all and silently stalled; two renderings of one Screen (a fill/key pair, a redundant machine) each advanced the page, at double rate. Every tick cost a realtime fan-out plus a Screen re-fetch by every client (the pattern ADR-0004 rejects), and outputs writing contradicted the invariant that a Screen Output only enters presence and answers commands, which race-safety arguments in the code rely on. Synchronisation instead falls out of the shared RTT-compensated clock (`useServerTime`), the way outputs already agree on animation phases, and paging continues through a realtime outage.

### Consequences

- Screen Outputs are pure consumers again; the paging persist was the only output-originated server write.
- Flips land within clock-sync tolerance across renderings (tens of milliseconds); frame-atomic flips across independent browsers were never achievable.
- When the row set changes mid-rotation the projected page can jump, identically everywhere. Nothing re-anchors on data changes — determinism, not continuity, is the invariant.
- The metagame toggle is the canonical `autoPageEnabled` (a pre-ship data migration rewrote stored blobs; squashed by ADR-0019).

### Rejected alternatives

- **An elected writer** (first output in presence, or the server) running the timer — fixes stall and double-advance but keeps leader election and failover mid-show, per-tick fan-out and re-fetch traffic, and outputs that write.
