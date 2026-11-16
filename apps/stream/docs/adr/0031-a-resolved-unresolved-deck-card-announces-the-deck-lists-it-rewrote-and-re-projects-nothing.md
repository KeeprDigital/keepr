# ADR-0031: A resolved Unresolved Deck Card announces the Deck Lists it rewrote, and re-projects nothing

Accepted · 2026-10-20 · [#648](https://github.com/KeeprDigital/stream-keepr/issues/648)

### Decision

**Resolving an Unresolved Deck Card publishes `playerDeck:cardsResolved`** once its batch commits. The message names every Deck List the resolution rewrote and their Players (`deckIds`, `playerIds`), because one resolution rewrites every Deck List in the Event holding that name, not only the one the operator opened. It publishes plainly: no Graphic Input Binding reads a Deck List's cards.

**No Player revision moves and no Archetype projection re-runs.** The projection reads only a deck's Archetype, review, name and colours, none of which a card changes. Key-card matching is a suggestion in the Archetype assignment UI, not part of the projection.

**Screen Outputs re-read through what they already follow.** The Metagame and Most Played Cards breakdowns re-read on every resolution. The Deck List mode re-reads when the message names its selected Player, and the Feature Match Overlay sideboard when it names either side's Player. A Screen Output or Program Monitor is told so by its Screen's channel, as a `playerDeck` cause the server has already narrowed to those Players; a preview applies the same rule to the message itself. Neither compares a revision any more, since a cause carries none: a re-read answering what is on program swaps nothing.

**Operator browsers drop what they cached.** An operator browser drops those Players' cached Deck Lists and invalidates its Metagame pages. The resolving browser does the same itself, since it skips its own message. A read in flight when its Player's entry is dropped is not cached when it lands.

**Reconnect Resync drops the whole Player deck cache.** Contradicts Reconnect Resync's "a resync re-reads and never clears" (RULES.md, ADR-0028) — worth it because the deck cache is a read-through cache, not held Event Data: it renders nothing of its own, and every reader fetches through it. It is keyed by Player revision, which a missed resolution never moves, so nothing else would ever re-read it. Melee sync refreshes already drop it the same way.

### Why

The resolution published nothing. Only the resolving browser cleared its own deck cache. Every other browser and every Screen Output kept the old Deck Lists until some unrelated change made them read again.

### Consequences

- A degraded Deck or sideboard rebuild is compared by what it was built from, not by Player revision. Otherwise a rewritten Deck List could be kept off program as "unchanged" while Scryfall is still failing.
- A surface that already holds a deck read from the cache keeps it until it reads again: Feature Match deck counters and tokens, an open Player deck modal, a Card Spotlight Screen's Deck List source. Only its next read is fresh. A resolved card that adds a deck counter type reaches the Feature Match counters only then.
- Other operators' Unresolved Deck Card lists on the Melee sync page do not follow the message. A second resolution of the same group gets a 404 and reloads the list.
- A Companion resolution names every matching Deck List, including one whose manual Companion it left alone. That one re-reads for nothing.

### Rejected alternatives

- **Reuse `melee:decklistsSynced`.** This is an operator edit, not a sync, and the operator handler for that message reloads whole collections.
- **Roll each affected Player's `updatedAt` and publish `player:updated`.** That reuses the revision-keyed paths, but it sends one message per Player, possibly hundreds for a common misspelling. It also reports a Player change that did not happen.
- **Name the deck cache as an Event Data Resync dataset.** Its readers do not consume it while mounted. They fetch through it on demand, so nothing would name it at a resync.
