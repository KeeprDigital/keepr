# ADR-0046: Melee Sync keeps a Player field an operator edited

Accepted · 2026-10-26

### Decision

**A Player records the Melee-imported fields an operator has edited, and Melee Sync stops writing them.** `players.manually_edited_fields` is a JSON list drawn from `PLAYER_MANUALLY_EDITED_FIELD_VALUES`, `name` and `pronouns`. `playerService().update`, the one manual Player write behind the Players page and a Slot setup's write-through (ADR-0045), adds a field to it in the same statement when the write changes that field's value. The Melee bulk upsert (`buildBulkPlayerUpsertQueries`), shared by the Players sync and the Deck List sync, keeps the Player's own value for each listed field and takes Melee's for the rest.

**An edit is a change of value.** Writing the value a field already holds marks nothing, whatever a save carries. Edit Player sends only the fields its operator changed, measured against the Player as held when it saves (#1026). It once sent its whole form as opened, so a name Melee Sync changed under the open modal was written back and marked. Clearing a field is an edit: an operator who removes pronouns keeps them removed rather than taking Melee's.

**Records stay Melee-owned.** Wins, losses, draws, position and points are not in the list: a manual edit to one lasts until the next sync, as before. LGS and game data are not imported, so they never needed it.

**The column is server-managed.** It is classified so in `PROVENANCE_ENTITIES`, never accepted from a client, and not part of `PlayerResponse`.

### Why

The Melee upsert wrote `excluded.name` unconditionally, and `excluded.pronouns` as `null` whenever Melee held none. So an operator's rename or pronouns, from either surface, reverted at the next Players or Deck List sync, and Reverse Sync then carried the revert onto every Slot. An operator expects one edit to a Player to hold across the Event.

### Consequences

- Nothing hands a field back to Melee yet. A Player whose edited name later changes on Melee keeps the edited one until the field is removed from the list. A "reset to Melee" action is its own change.
- A Player with no list is read as having an empty one, so it takes Melee's values until edited.
- `test/unit/server/services/playerManualEditsSurviveMeleeSync.sqlite.test.ts` covers both sync paths, a cleared field, an unchanged whole-form save, and an edit made in a Slot's setup. `test/nuxt/components/Player/ManageModal.test.ts` covers what Edit Player sends.

### Rejected alternatives

- **Never let Melee blank a field** (`coalesce(excluded.pronouns, players.pronouns)`). It keeps pronouns Melee lacks, but a non-empty Melee value still overwrites an edit, and a rename still reverts.
- **Store Melee's value and the operator's side by side.** It supports a reset for free, but every reader of a Player would choose between two values. A list of edited fields answers the same question with one column.
