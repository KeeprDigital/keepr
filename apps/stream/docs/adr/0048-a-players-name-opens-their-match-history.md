# ADR-0048: A Player's name opens their match history

Accepted · 2026-10-27

### Decision

**Clicking a Player's name, on any operator page, opens that Player's match history, as clicking a deck name opens its deck list.** `PlayerMatchHistoryButton` (`app/components/Player/MatchHistoryButton.vue`) renders every such name. It takes the Player and, when the surface shows other text, such as a Match's snapshot name or "TBD", that text. A name with no Player behind it, like a seat filled by hand or an opponent off the roster, is plain text. The button carries no icon; it takes the hover colour the deck name uses.

It renders names on the Players page, Matches rows (both seats and the bye), the match history modal's opponent column, the deck list modal's title, the Feature Match live panel's seats and the metagame Players table. Surfaces that know only a name, like the card page's deck column headers and the sync page, stay plain text, as do pickers that choose a Player.

**A row on the Players page does nothing when clicked.** Edit Player is the first action in the row menu, and the menu no longer offers View Match History, because the name already opens it.

**The row menu is a `UDropdownMenu`, mounted only once its row's trigger is clicked**, so it has menu roles and keyboard navigation without a menu per virtualized row. Player Lists sit under Add to List, and a Screen send becomes a submenu (Send Deck to…, Send Match History to…) once more than one Screen could take it.

**On the Players page, `?player=<id>` names the Player whose history is open** (`usePlayerMatchHistoryLink`): arriving with it opens their history once the roster loads, and it follows the modal to another Player and away when it closes. Other pages open the modal without a link, since no shell is shared between them.

**Every name opens one modal.** `usePlayerMatchHistoryModal` is a shared composable, so opening another Player, an opponent from inside the modal included, replaces what the open modal shows instead of stacking a second one.

**The match history modal is a Player's detail view.** Its footer holds Edit Player, Deck List, the Player List memberships (checked, toggled in place) and Send to Screen, and each row with a roster opponent sends a Head-to-Head of the shown Player and that opponent to a Head-to-Head Screen, picking both directly (`playerSource: 'players'`). Its header gives the record as the Event displays records, the Players page's Record column does too, and the pronouns and LGS the Event shows. Opening an opponent from it remembers the way back, one Player at a time, until the modal closes. It reads the history itself through `usePlayerMatchHistory`, which follows the Event Data a Player History Screen follows (`playerHistoryDependencies`, Screen Mode Data Freshness), so a Match reported or a Melee Sync landing while it is open shows without reopening it.

### Why

The Players page opened Edit on a row click and kept history in the menu, while every other page showed names that did nothing. Viewing a Player's history is the expected default, and editing is the deliberate act. One meaning for a name everywhere means an operator learns it once.

### Consequences

- A new surface that shows a Player's name renders it through `PlayerMatchHistoryButton`.
- Without the shared composable, each button would create an overlay of its own through `useOverlay().create`, which never removes one.
- `test/nuxt/components/Player/MatchHistoryButton.test.ts` pins the rule and the single modal; each surface has one wiring test.

### Rejected alternatives

- **Make the whole Players page row open history.** It would hide one target behind another again, and the deck cell and row menu sit in the same row.
- **Link a name the surface knows only as text by matching it against the roster.** Two Players can share a name, and the wrong history is worse than none.
