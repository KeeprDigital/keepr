# ADR-0058: A Feature Match Session owns which side each player sits on

Accepted · 2026-11-03 · [#886](https://github.com/KeeprDigital/stream-keepr/issues/886). Settles the rule 41bfa662 (#314) left in code comments; extends ADR-0056.

### Decision

**Side order belongs to the active Feature Match Session; the Feature Match Slot keeps its pairing order.** `SwapPlayers` swaps the Session's source snapshot and current state and sets `playersSwapped`. It never writes the Slot. A `SnapshotCorrected` rebuilt from the Slot is put back into the Session's orientation by the reducer, as 41bfa662 made it.

**A surface that shows a side beside the Session's live state takes that side's player from the active Session's source snapshot, and from the Slot only while no Session is active.** `featureMatchSidePlayer` (`shared/utils/featureMatchSidePlayer.ts`) states the rule. The Feature Match Overlay's token values follow it, and so does the ADR-0056 public read, which shares them. So do the Overlay's sideboards and the controls' deck name and deck counters. So do the surfaces that name a Slot's pairing: a Head-to-Head from a Slot, the Card Spotlight Screen's matchup Deck Lists from a Slot, and the Slot pickers' "A vs B" labels ([#891](https://github.com/KeeprDigital/stream-keepr/issues/891)), so none of them shows the players on the opposite sides from the Overlay. The controls' names and Graphic Input Bindings already read the snapshot. A client surface reads the Session the Live State Follower holds, not the one the Slot's last read carried (`withFollowedFeatureMatchSession`), because `SwapPlayers` moves only the Session.

**The Slot setup form edits the Slot in Slot order and shows it in the Session's.** Swap Players sends only `SwapPlayers`. The form keeps the Slot's sides, and each shown column reads and writes the Slot side its player holds, so a save sends each edit to its own player and a swap leaves nothing to save.

### Why

Two owners disagreed (#886). The Session owned side order, while the setup form swapped the Slot's sides alongside `SwapPlayers` and Save wrote them. The Overlay read names from the Slot and life, game wins and active and first player from the Session. After Swap the Overlay paired each name with the other player's state. After Save the Slot was swapped too, the correction re-oriented the rebuild a second time, and the controls paired each name with the other player's state. No sequence of steps put every surface right. Keeping the Session as the one owner fixes it without a Slot write beside a Session command, which Sequenced Live State cannot make atomic, and Reverse Sync and Feature Match Slot Promotion keep writing Match order to the Slot unchallenged.

### Consequences

- A Slot's sides, and a Slot-side Feature Match Deck List or Leader (ADR-0057), never move on a swap. The Session's snapshot carries them with their player.
- A new Session opens in Slot order: a swap lasts as long as its Session.
- A Deck List Screen whose Deck Source is a Slot side follows that Slot side's player, whichever side the Session shows them on. Every surface that shows a Slot's two sides shows them in the Session's order; with no active Session it shows Slot order. A Head-to-Head re-reads when the Session seats its Players on the other sides, and the Card Spotlight Screen's matchup Deck Lists reload. A Match picked by Round keeps Match order, because a Match has no Session.
- The Overlay's player values now come from the snapshot, which merges a seated Player's data under the Slot's overrides, as Graphic Input Bindings already did.
- A Session swapped and then saved before this decision holds its snapshot back in Slot order while its state stays swapped. Resetting the match realigns it, and so does any new Session.
- Neither ADR-0045 nor ADR-0015 changes. A setup save still writes a seated Player's identity edits through, by the Slot side's Player, and sideboard reveal still rides Session state per side.
- `test/unit/server/services/featureMatchSideOrder.sqlite.test.ts` holds the swap, swap-then-save and swap-save-swap paths for an MTG and an OP Event.

### Rejected alternatives

- **The Slot owns side order, and `SwapPlayers` swaps the Slot row too.** It needs a Slot write alongside a Session command, and it conflicts with promotion and Reverse Sync, which write Match order.
- **Detect a swapped Slot in the correction.** It would have to match players by id, or by typed data on an OP Event, and the Overlay would still be wrong between Swap and Save.
