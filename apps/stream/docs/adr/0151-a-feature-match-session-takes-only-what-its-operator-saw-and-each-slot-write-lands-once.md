# ADR-0151: A Feature Match Session takes only what its Operator saw, and each Slot write lands once

Accepted · 2026-11-20 · [#1377](https://github.com/KeeprDigital/keepr/issues/1377) · Amends ADR-0045 and ADR-0087

A review of Feature Match production found a Session that changed by what no Operator saw. Every command re-read the Slot before it was sent, so an absolute command always claimed the newest sequence and the stale-sequence refusal never protected the view its Operator acted on. Every open page started extra turns from its own clock. A second quick tap on one control was dropped without a word. Swap Seats wrote the Slot and then the Session, so a failure between them left the two crossed, and a retry crossed them again. A setup save naming a Commander Seat without its game data deleted the Seat's Deck List.

### Decision

**A command claims the Session the page holds.** The client sends each absolute command with the sequence of the Session it shows, and reads the Slot only after a `409`, handing the page the Session it read. A Slot's commands go one at a time, each claiming the Session the one before it left, so an Operator's own taps never refuse each other. A second tap on a control whose first is still out is shown at once and sent after it, never dropped; an absolute command queued behind one that is refused was made from the same view, and is refused with it rather than sent over the Session the client re-read. A refused prediction rolls back to the state the server last accepted, never to an earlier prediction it refused too.

**The server starts extra turns by its own reading of the clock.** `StartOvertime` is stamped with the server's time, as a clock command is, and refused while the clock has time left at that time. It changes nothing once extra turns are under way, so it merges onto a Session that moved on. Any page that sees the clock run out asks, the one opened after it ran out included, and the first to land starts them.

**A Slot has a version.** `feature_match_slots.version` (migration `0007_feature_match_slot_version`) goes up by one with each setup save and Swap Seats, in the statement that writes it. A Session's snapshot carries the version it was built from (`slotVersion`), and a correction or Swap Seats built from an older Slot than the one the Session holds changes nothing, so two saves that reach the Session in the other order leave the newer. A setup save names the version its form showed; a Slot another save has moved past refuses it (`409`), so the second of two Operators saving one Seat is told rather than overwritten.

**Swap Seats commits the Slot and the Session in one batch.** The sequenced live-state module takes a companion write: statements run first in a command's batch, guarded by its compare-and-swap, and a condition its receipt and projection also require. Swap Seats' companion writes the Slot at its next version from the version and Seats it read, and the Session's write requires the Slot to hold the two Seats as swapped at that version, so the batch commits both or neither, and a Slot moved meanwhile refuses the swap.

**A seated Player is written once the Slot's write has committed.** A setup save writes the Slot, announces it, and then writes the Player's name, pronouns and LGS. That write's Reverse Sync reaches every other Slot seating the Player and leaves the edited Slot as the save left it, so a record edited in the same save still holds. A save the Slot refuses writes no Player.

**A Seat keeps what a save does not name.** A Commander setup save naming a Seat with no game data keeps its Commanders and Deck List; `gameData: null` clears them. A Deck List paste whose save fails deletes its list only when no Seat of the Slot names it after the failure, on a Commander Seat and a One Piece Card Game side alike.

**A Commander game's first Seat is chosen once.** Selecting or setting the first Seat once one went first is refused; a reset is what changes it. An outcome won by a Seat that is later emptied is taken back, reopening the game; a draw stays drawn.

**What rides every Session message is bounded.** A Seat holds at most 20 counters, and a Seat's pasted deck list text stays on the Slot, out of the snapshot every Session message carries.

### Consequences

- ADR-0045's order is reversed: a save that fails on the Slot has written no Player. A save whose Slot write commits and whose Player write then fails keeps the Slot's edit, and the Operator retries.
- ADR-0087's Swap Seats is no longer one statement on the Slot, and is refused (`409`) for a Slot another write moved since it was read.
- A page whose held Session is behind sees its absolute command refused and the Session it missed, where it used to see its command land over it.
- `test/unit/shared/featureMatchSessionOvertime.test.ts`, `test/unit/app/modules/featureMatchSessionClient.test.ts`, `test/nuxt/modules/optimisticState.test.ts` and `test/unit/server/modules/featureMatchSlotWriteFailures.sqlite.test.ts` hold the rules.

### Rejected alternatives

- **Derive extra turns from the clock at read time.** It needs no page at all, but every rendering of a Session would compute them, and a step back from the first extra turn would have nowhere to be held.
- **A Swap Seats that names the arrangement it wants.** A Commander Seat has no Player id to name it by, and two Seats holding the same typed data could not be told apart.
- **Retry a refused command with the re-read sequence.** It lands the command over the state its Operator never saw, which is what the refusal is for.
