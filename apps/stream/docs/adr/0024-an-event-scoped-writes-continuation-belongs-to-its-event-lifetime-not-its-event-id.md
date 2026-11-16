# ADR-0024: An Event-scoped write's continuation belongs to its Event Lifetime, not its Event id

The client resets every Event-scoped store when the operator leaves an Event, then loads the next one. A write answered after that used to land in whatever the stores held by then. A save of Event A merged A's response, id and all, into Event B. A failed delete put A's row back into B's list. An Archetype edit reloaded A's Feature Match Slots into B's store (#606).

### Decision

**Each Event-scoped store begins a new Event Lifetime on reset, as a Flight from its own Guarded Sequence.** A write captures the current Flight before it awaits. Its continuation runs only while that Flight is current. That covers merging the answer, the optimistic rollback, the error and loading refs, and anything it starts afterwards: priming a Feature Match Session, reloading Slots, invalidating the Metagame. `useAsyncAction` takes the Flight as `flight`. While that Flight is stale, `useAsyncAction` leaves `errorRef` and `loadingRef` alone and does not call `onError`. The Event Data lifecycle module exposes `currentLifetime()` for the stores built on it, and so do the Feature Match Slot and Assignment stores, for the Slot Promotion workflow that writes into both.

This covers the Event store (Event and Talent writes), every Event Data collection, Player List members, Feature Match Slots, Assignments and Slot Promotions, Archetypes, Screens, Deck reviews, Broadcast Deck List creates, Melee operations and the Card store's saves and Clears (#726).

A stale continuation still returns its answer, or raises its failure, to the caller that started the write. The write did happen, and the operator is told so. Only cross-Event state is still updated: the Events list learns a late save or create, because no Event Lifetime owns it. A late Event delete still clears the loaded Event when its id matches, in any lifetime, because that Event no longer exists.

### Why

An Event id cannot tell two lifetimes of the same Event apart. After A → B → A, the second A was loaded fresh. It may already hold what the late answer describes, or something newer. Merging the answer can duplicate a row or bring back an older value, and a rollback can put back a row the reload already has. Flight identity tells the lifetimes apart. The id does not.

### Consequences

- A create answered after the operator returned to the same Event is not added to that Event's collection. The self-origin guard skips this client's own realtime notification, so the row appears after the next load or reconnect resync, not immediately. That is accepted. The alternative is merging answers that the fresh load may already have overtaken.
- Each store's own `$reset` is its lifetime boundary, as it was already the boundary for loads. `resetAllEventStores()` resets them all together. A store that switches Events without a reset (the Assignment and Broadcast Deck List stores, through `ensureEvent`) begins a new lifetime there too.
- A Melee operation from an earlier lifetime no longer answers one started since. The in-flight coalescing is cleared on reset.
- The write itself is not a continuation. One still queued, or retrying a lost race, when its lifetime ends is still sent for its own Event and Screen, at the revision that lifetime last knew (ADR-0041); only its effects on the stores are gated.
- Ordering _within_ one lifetime is unchanged. This decision does not replace live aggregates' sequence and epoch rules (#590, #591). A Slot Promotion result is dropped when its lifetime ended, and otherwise still meets those rules.
- The Card store holds one Screen's Card, so a Screen selection is a boundary too: selecting a Screen, even the one already selected, begins a new Flight within the lifetime, and a save or Clear answered after it touches nothing. Its Card reads were already Flights that a selection, a reset and anything newer supersede (#704). A Clear changes nothing it holds until its `DELETE` succeeds, so a failed one has nothing to roll back: what the store accepted meanwhile stands (#726). Within a selection, the Card's writes, reads and announcements are ordered by its Card Revision (ADR-0042).

### Rejected alternatives

- **Compare the current Event id after each await** — what the code did. It is blind to A → B → A.
- **One application-wide Event Lifetime superseded in `resetAllEventStores()`** — one place to look. But a store reset on its own would then keep its old lifetime, and the Event Data lifecycle module would have to import the module that imports it.
