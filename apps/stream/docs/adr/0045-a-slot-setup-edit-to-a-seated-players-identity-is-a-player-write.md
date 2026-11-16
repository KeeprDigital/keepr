# ADR-0045: A Slot setup edit to a seated Player's identity is a Player write

Accepted · 2026-10-26

### Decision

**A Feature Match Slot setup save that edits a seated Player's name, pronouns or LGS writes those fields to the Player.** `featureMatchSlotWriteModule().updateSetup` compares each side's submitted `name`, `pronouns` and `lgs` with the Player seated there (the side's `playerNId` in the save, else the Slot's) and sends the differences through `playerUpdateModule().updatePlayer`. An omitted field was not edited and is left alone. A cleared name is a Player write only for a Player with a Nickname to fall back to (ADR-0074); otherwise it stays on the Slot only, because a Player always shows by something. A side with no Player seated has nothing to write.

**Records, deck and archetype stay Slot snapshot fields.** A setup edit to wins, losses, draws, position, points, deck or archetype is held by the Slot only, and Melee Sync's standings reach it through Reverse Sync as before. The exception is a One Piece Card Game side linked to a Player: its Leader and Deck List are the Player's, so a setup save never writes them, and they are edited as the Player's Deck List (ADR-0074).

**The Player write runs before the Slot write, and is published with no origin.** Its Reverse Sync rewrites every Slot seating the Player, the edited one included, from the Player; the Slot write that follows then lands the rest of the save on the edited Slot, so a record edited in the same save is not overwritten. The saving client applied only the Slot, so it must receive the Player's and the other Slots' messages too.

### Why

Reverse Sync rebuilds a Slot's player snapshot from the Player after every Player write and Melee Sync. An identity edit held only by the Slot was therefore lost to the next round "Sync Matches": an LGS typed in setup was cleared because the Player had none. An operator expects one edit to a featured Player to hold across the Event, so the Player has to hold it.

### Consequences

- The write-through is an ordinary manual Player write, so a name or pronouns it changes becomes a Manually Edited Field and holds through Melee Sync (ADR-0046). LGS is never imported and holds anyway.
- A setup save that fails on the Slot write (a `409`, or the Slot deleted) has already written the Player. The Player's edit stands and the operator retries the Slot.
- `test/unit/server/services/featureMatchSlotSetupSurvivesReverseSync.sqlite.test.ts` holds the round-sync and One Piece Nickname cases against SQLite, and the order by its outcome: a record edited in the same save stays on the Slot. `test/unit/server/modules/eventDataWrites.sqlite.test.ts` holds the missing origin.

### Rejected alternatives

- **Freeze a Slot's snapshot at promotion.** Standings and reviewed-deck corrections would stop reaching a featured Match, and the setup form would still disagree with the Players page.
- **Pin setup-edited fields on the Slot against Reverse Sync.** It keeps the LGS on one Slot, but the Player, other Slots and the next round still lack it, so the operator enters it again.
