# ADR-0029: Sequenced Live State opens and closes epochs, and announces only what a commit changed

Accepted · 2026-10-20 · [#593](https://github.com/KeeprDigital/stream-keepr/issues/593)

### Decision

**Every epoch of a live aggregate opens and closes through Sequenced Live State.** `createSequencedLiveEpochs` (`server/modules/live-state/epochs.ts`) builds a transition: the feature's close statements, a statement forgetting the ended epochs' Command Receipts, and the feature's open statements, in that order. The caller commits them alone or inside a larger batch, then settles the transition. The feature supplies only which epochs a scope holds and how one is closed, opened and announced. Feature Match Sessions (the sessions route, Slot create, update and sync, the command fallback, Slot Promotion, the Melee reset) and Broadcast Graphics Live Sessions (reset, mode change, Screen delete, first load) all use it.

**Whether to announce is decided from the commit.** The scope's active epochs are read when the transition is built and again when it settles. Only a difference is announced. A transition whose conditions skipped a Slot or Screen announces nothing for it. A new Feature Match Session is announced as its own `SessionStarted`, carrying its whole snapshot, and Graphic Input Bindings re-resolve once per transition. A Slot Promotion publishes its Sessions' `SessionStarted` among its own messages instead (ADR-0033). A Broadcast Graphics epoch change is announced as `epochEnded`. An end on the way to a Screen's deletion and the epoch a first load opens opt out.

### Why

The close, open and receipt-forgetting sequence was written by hand in three places. Only the sessions route announced a new Feature Match Session. Every other opener relied on a later Feature Match message happening to carry it, which five race fixes traced back to. Receipts are keyed by aggregate id and epochs never reuse one (ADR-0026). So a receipt from an ended epoch cannot answer a command in its successor, and forgetting it in the same commit keeps the store bounded.

### Consequences

- Command Receipts from an ended epoch are gone in the commit that ends it. That is pinned against SQLite in `test/unit/server/modules/liveStateEpochs.sqlite.test.ts`.
- A Screen leaving Broadcast Graphics mode with no active epoch no longer publishes `epochEnded` with a null session.
- A Slot write that opens a Session now re-resolves bindings twice: once for the Session and once for the Slot's own `featureMatch:updated`. A Slot Promotion re-resolves once (ADR-0033).
- Every Feature Match Session transition selects its Slots through one JSON-array subquery. So a whole Event's Slots open in a handful of statements, and the Melee reset is no longer its own variant.
- ADR-0004 is unaffected: a command's notification still carries the difference.
- A promotion that commits but loses to a later one before its outcome is decided announces nothing (#576). That includes the new Sessions of the Slots it cleared. Peers show those Slots' previous Sessions until the next resync or Slot message. This was accepted because it needs two operators promoting the same Match within moments, and it corrects itself.

### Rejected alternatives

- **Announce a lost promotion's cleared Slots' Sessions.** Peers would see part of a promotion its operator was told failed.
- **Announce what the caller asked for.** A Melee reset that skipped a manually rebound Slot would announce a Session that never opened.
- **Announce ended Feature Match Sessions too.** Their successor's `SessionStarted` already moves every follower past them.
