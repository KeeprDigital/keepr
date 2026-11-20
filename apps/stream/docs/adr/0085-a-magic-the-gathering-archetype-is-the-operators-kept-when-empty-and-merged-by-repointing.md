# ADR-0085: A Magic: The Gathering Archetype is the operator's: kept when empty, and merged by repointing

Accepted · 2026-11-12 · [#1151](https://github.com/KeeprDigital/stream-keepr/issues/1151), [#1154](https://github.com/KeeprDigital/stream-keepr/issues/1154). Extends ADR-0060; contrasts ADR-0074. · Amended by ADR-0152: the name is unique ignoring case at the database, and names held twice in another case are renamed

### Decision

**An MTG Empty Archetype stays until an operator removes it.** Nothing removes one when its last Deck List leaves, by a reassignment, a Melee Sync that clears a changed deck's review, or a Player's deletion. The operator deletes it on its Metagame page, or removes every Empty Archetype at once from the Metagame page, which lists them under the Archetype table because the table counts Pilots and these have none. The bulk removal judges emptiness in its own delete (`buildRemoveEmptyQuery`): no Deck List assigned, primary or not, and no Player holding it without one, as the Player write allows. Each removal releases the Screens naming it (ADR-0060) and is announced as a delete.

**The Archetype's Metagame page is where an operator edits it.** Rename, on MTG as on One Piece Card Game; delete, with a confirm naming the decks that return to unreviewed and the Screens that will show none; merge. A One Piece Archetype still follows its Leader: it is renamed and pinned only (ADR-0074), and the server refuses its merge and its removal.

**An Event holds one Archetype per name, ignoring case and surrounding spaces** (`sameArchetypeName`). The Archetype write refuses a create or rename onto a held name with a 409 naming the holder, and a name is stored trimmed. The unique index stays case-sensitive, so Archetypes that already differ only by case stay until an operator merges them.

**Merging A into B repoints, where deleting A would release.** One batch moves every Deck List reviewed as A to B, still reviewed; moves a Player holding A without a Deck List; names B in every declared Event Reference of kind `archetype` naming A (`buildRepointScreenEventReferencesQuery`, read from the same declarations a release reads, ADR-0038); and deletes A. B keeps its name, colours, key cards and Pinned Chart Series; A's go with it. The page offers a merge when a rename names a held name, and as "Merge into…".

**A merge is announced as a delete that names its survivor.** `archetype:deleted` carries `mergedIntoArchetypeId`. A browser moves the decks it holds to the survivor where a plain delete would untag them, and a Screen following either Archetype is told (`shared/screenOutputInterest.ts`). The re-projected Players go out first in one `player:deckProjectionsChanged` (ADR-0084), and each repointed Screen before that, without an origin, as a release's are.

### Why

An MTG Archetype is authored: an operator names it, colours it, picks its key cards, may pin its series, and may point an Archetype Spotlight at it. A One Piece Archetype is derived from a Leader and can be derived again, which is why ADR-0074 removes it when empty. Removing an MTG one automatically would discard that work, and at the worst moment: a Melee Sync clears the review of a deck whose list changed, and the operator re-reviews it into the same Archetype moments later. Its key cards and pin would be gone and the Spotlight Screen naming it unset, on air.

A merge exists because two Archetypes are one: a typo, a casing slip, or a split the operator regrets. Releasing the Screens naming the merged one would blank a Screen that should go on showing the same decks under the survivor's name.

The name rule lives in the write and not in the index because existing Events hold case-variants; a unique index over `lower(name)` would refuse to build over them.

### Consequences

- An Event can hold Archetypes no Metagame read counts. The Metagame page lists them, and the Archetype pickers mark them empty rather than hide them, since a Screen may name one and review may be about to assign to one.
- Two operators creating case-variants of one name at the same instant can both succeed: the check reads, then writes. The merge is the repair.
- A browser that holds none of a merged Archetype's decks learns of the move from the Players' re-read alone.
- `archetype:deleted` has an optional field an older client ignores. It untags the merged Archetype's decks it holds until it reloads them.
- A Player holding an Archetype without a Deck List is moved by a merge but not re-announced: nothing re-projects them. The same gap exists on a delete, which clears their Archetype by the foreign key.
- `test/unit/server/modules/archetypeWrite.sqlite.test.ts` holds the name rule, the merge and the bulk removal; `screenReferenceRelease.sqlite.test.ts` the repointing of every declared Archetype reference.

### Rejected alternatives

- **Remove an emptied MTG Archetype automatically**, as ADR-0074 does. Costs the operator's key cards, pin and Screens whenever a sync or a reassignment empties one in passing.
- **Remove it automatically unless customised.** On MTG every Archetype is the operator's, so the flag would spare all of them or need a second meaning.
- **Hide Empty Archetypes from pickers.** They would be undeletable and unexplained, and a Screen already naming one would show a blank pick.
- **Merge by deleting A and re-reviewing its decks into B**, client-side. Not atomic, one write per deck, and every Screen naming A released on the way.
- **A new `archetype:merged` message.** Every consumer of `archetype:deleted` would need a second handler for what is, to all but the deck stores, the same change.
