# ADR-0060: Deleting a Phase, Round or Archetype releases every Event Reference naming it

Accepted · 2026-11-03 · [#907](https://github.com/KeeprDigital/stream-keepr/issues/907). Extends ADR-0032 and ADR-0038. · Amended 2026-11-10: a Feature Match Slot delete releases every Event Reference naming the Slot · Amended 2026-11-12: an Archetype delete releases the Archetype filter of a Metagame or Most Played Cards Screen · [#1153](https://github.com/KeeprDigital/stream-keepr/issues/1153)

### Decision

**A Phase, Round or Archetype a Screen names can be deleted, and the delete unsets that Event Reference in the same write.** `buildReleaseScreenEventReferencesQuery` removes, from each Screen in the Event, every Event Reference of the given kinds naming a record the Event no longer holds, and bumps its `stateVersion`. The fields come from the Screen Mode Definitions' `eventReferences` of kind `phase`, `round` and `archetype` (ADR-0038), not a list kept here, so a new mode declaring one is released with no further change. Today they are Top Cut Bracket `phaseId`, Standings, Pairings and Round Clock `roundId`, and Archetype Spotlight, Metagame and Most Played Cards `archetypeId` (the last two their Archetype filter, #1153). The field is removed, not nulled: each is optional, a Standings Screen with no Round shows the Current Round, and a Metagame or Most Played Cards Screen with no Archetype filter counts every Archetype's cards.

**Every path that deletes one runs it, in the delete's batch, after the delete.** Deleting a Round releases Rounds; deleting a Phase releases Phases and the Rounds it cascades away; deleting an Archetype releases Archetypes. Melee Sync's removal of stale imported structure and the Melee data reset release Phases and Rounds (`buildRemoveImportedStructureQueries`). It runs after the delete, unlike ADR-0032's clear, and selects by absence rather than by id: a cascade and an imported structure removal decide what they delete as the batch runs (ADR-0040), so only afterwards does the Event say what is gone.

**Each released Screen is announced with `screen:updated`, ahead of the delete's own announcement and without an origin**, as ADR-0032 does. The Melee data reset answers a Screen both its releases rewrote once, at the later version.

**A Feature Match Slot delete releases every `featureMatchSlot` Event Reference the same way** (amended 2026-11-10): Card Spotlight, Feature Match Controls, Feature Match Overlay and Head-to-Head `featureMatchId`. Both paths that delete Slots run the query after the delete, in its batch: deleting one Slot, and lowering the Event's Slot count. It runs beside ADR-0057's Deck Source clear, which still runs ahead of the delete, and a Screen both rewrote is announced once, at the later version. The field is set to null, not removed: Feature Match Controls and the Overlay require it, and null is their no-Slot state. A Screen Output following its own Screen channel is told `screen:updated`, re-reads its Screen and shows that state; told only that the Slot changed, it would re-read a Slot that answers 404 and hold the deleted Slot on air (Screen Mode Data Freshness keeps the last answer).

**Contradicts ADR-0030, which says every Screen write passes through `screenWriteModule()`,** as ADR-0032 does and for the same reason: the release has to commit in the delete's batch. It also skips the ADR-0038 reference check every Screen write runs; it only removes Event References, so it cannot name anything outside the Event.

### Why

A Screen left naming a deleted Phase, Round or Archetype rendered an empty bracket, a missing Round or an error state, and every later full Screen write failed, because the write checks every declared Event Reference (ADR-0038). The operator could not save the Screen until they repicked. Unset is what an operator gets by deselecting first, and the Melee data reset and a sync delete this structure as a side effect, so refusing the delete would make them hunt for Screens first. A Player (ADR-0032) and a Feature Match Slot (ADR-0057) were already released by their deletes, though their Deck Source keeps the field as null where these remove it.

### Consequences

- An operator form that read a released Screen before the delete gets a `stateVersion` conflict on its next save, as for any concurrent Screen write, lease holder included.
- A Screen already naming a missing Phase, Round or Archetype is released by the next delete of that kind in its Event, whichever record that delete names.
- A Phase or Round delete that finds nothing to delete still releases what the Event no longer holds, and announces it. An Archetype delete refuses a missing Archetype before it writes.
- Player and Player List references (Player History, Head-to-Head, `playerListId`) are not covered here.
- ADR-0070 adds Talent and Talent Lineup references, released by a Talent delete through this query.
- A Slot delete that finds no Slot still releases what the Event no longer holds, and announces it, before it answers 404.

### Rejected alternatives

- **Clear by the deleted ids, ahead of the delete, as ADR-0032 does.** The imported structure removal decides which Phases and Rounds go as its batch runs, and a Phase takes its Rounds by cascade; each would need its own prediction of what will be deleted.
- **`AFTER DELETE` triggers.** Rejected for ADR-0032's reason: the service could not say which Screens changed, and they must be announced.
