# ADR-0074: A One Piece Card Game Event's Players and their Deck Lists come from a TCG+ Import, and its cards from one catalogue keyed by card number

Accepted · 2026-11-04 · [#1000](https://github.com/KeeprDigital/stream-keepr/issues/1000) · Changes ADR-0057. · Amended 2026-11-05 by ADR-0075, which offers OP Events Top Cut Bracket. · Amended 2026-11-15 ([#1013](https://github.com/KeeprDigital/stream-keepr/issues/1013)): an Unresolved Deck Card's resolution is remembered for the Event

### Decision

**An OP Event has Players, and each Player holds one Deck List.**

- **TCG+ Import.** The operator uploads the Bandai TCG+ deck list export on the OP Sync page, previews what it will change, and confirms. Nothing is saved before the confirm, and there is no undo.
- **Re-import.** It upserts Players by their Bandai member number. A Player missing from the file is marked inactive, never deleted, as Melee Sync does, and one back in it is active again. A Player's Deck List is replaced only when its cards changed, or when it holds an Unresolved Deck Card the catalogue now knows.
- **What the import ignores.** The export's status column is ignored. Rows sharing a card number, which are printings the export cannot tell apart, are summed into one entry.
- **Players added by hand.** They are kept as on MTG, and the import never matches them. When one's name or Nickname matches an incoming Nickname, the preview warns about a possible duplicate.

**A Player's Nickname is the import's, and their name is the operator's.** The import owns the Nickname and refreshes it on every import. The name is optional. Where it shows, ADR-0077 decides: the name fills the fields that show a name, and operator screens tell Players apart by Nickname.

**An OP Player's Deck List is imported or entered by hand, and a hand edit survives re-import.**

- **Where it's edited:** on the Players page, or from a Feature Match Slot side the Player is linked to, as a Player write (as ADR-0045 treats a seated Player's identity).
- **One write.** Every OP Deck List write, a Player's or an unlinked Slot side's, goes through the OP Deck List write (`server/modules/op-deck-list-write`), and each one gives the Deck List a new id, so whatever holds it by reference sees the change. A Player's game data holds only that reference and its Leader's card number; their Archetype and game data are the write's, and a Player write leaves them.
- **How it's edited:** the paste format and paste rules are ADR-0057's.
- **Re-import:** the preview flags a hand-edited Deck List the import differs from, and the operator may drop the edit to take the import's. The import still retries a hand-edited Deck List's Unresolved Deck Cards in its one lookup, and names any now known by rewriting the hand edit as a resolution, which keeps it hand-edited. The preview lists every Deck List the import rewrites.
- **Deck rule breaches** warn and never refuse.

**OP cards live in the shared card catalogue, keyed by card number; MTG cards stay keyed by name.**

- Player Deck Lists, pasted Feature Match Deck Lists and picked Leaders all reference the catalogue, replacing the inline snapshots ADR-0057 first kept. No stored snapshot is carried over: the migrations that built catalogue rows from them went in the second squash (ADR-0083).
- Card data comes only from bandai-keepr's bulk lookup. The export's own card fields are not used.
- A card number the catalogue already holds is never looked up again.
- If the lookup fails, the import or paste fails whole and saves nothing.
- A card number bandai-keepr does not know stays out of the catalogue. It is held number-only as an **Unresolved Deck Card**, with a warning, and retried on the next import or paste. The Cards page lists them Event-wide, with the Player and Slot side Deck Lists holding each.
- **Retry and resolve.** The operator can retry one through the bulk lookup, or resolve it to a card picked from a bandai-keepr search (through the server proxy, as the browser never calls bandai-keepr). Either names the card for every Deck List in the Event holding that number, as ADR-0031 does for MTG, by rewriting them through the OP Deck List write. A resolution is also remembered for the Event, so every later write holding the number saves the card picked. A rewrite keeps whether the Deck List was hand-edited, and copies of a picked card the Deck List already holds are added into its entry.
- **A resolution re-projects.** Contradicts ADR-0031, whose resolution re-projects nothing and announces only `playerDeck:cardsResolved`, because on OP the Leader is the Archetype projection, and every reader holds a Deck List by id. So each rewritten Deck List gets a new id and the write's own announcements (`player:updated` and Reverse Sync for a Player, the Slot's for a side), and a resolved Leader re-derives the Player's Archetype.

**An OP Player's Archetype is their Leader card.**

- **Created automatically.** One Archetype per distinct Leader card number, named after the Leader (with the card number when two Leaders share a name) and coloured by it.
- **Derived, not assigned.** A Player's Archetype follows their Leader. It is never reviewed or reassigned, though an operator may rename an Archetype or pin its chart series, which marks it customised for good. The server refuses Archetype Review and creating or deleting an Archetype by hand on OP.
- **Name clashes.** When a new Leader shares a name with an Archetype already in the Event, it and every clashing Archetype not customised take their card number, and keep it once the clash is gone, so names stay stable.
- **Removed when empty.** An auto-created Archetype left without Players, by a Deck List write or by deleting its last Player, is deleted, and the Screens naming it released, unless an operator renamed it or pinned a series. It is created again if a Player takes that Leader later.
- **Unknown Leader.** A Player whose Leader is unresolved is unclassified.

**OP Metagame counts every Player's Deck List, and reads participation only.**

- Its scopes are every Player and a Player List.
- With no standings, it shows no Conversion Target, Conversion Rate, win rate or average position.
- Its card rules are OP's: Character, Event and Stage, with no basic lands, highlander or Scryfall data.
- The read model holds these rules, read off the Event's Card Game (`getMetagameRules`), so a stored or requested scope it does not offer reads every Player, and a requested Conversion Target, win rate or place reads as none. The page and Screen editors offer only what it reads, and a Screen rendering hides any column it does not.

**A Feature Match Slot side takes a Player as on MTG, or manual data.**

- **Linked side.** Its Leader and Deck List are the Player's, by reference. A re-import or edit reaches the Slot, and the active Feature Match Session's snapshot is corrected, as replacing a paste is today. The side's game data is the server's: a setup save takes it from the Player whatever the form sent, and releases a Feature Match Deck List the side held. Its setup form edits the Player's Deck List, and a paste to the side itself is refused (`409`).
- **Unlinked side.** Paste and Leader picking stay available. That Feature Match Deck List never counts in Metagame.
- **Deck List Screen.** On an OP Event it takes a Player or a Slot side as its Deck Source, and both render in the OP layout. A Player source follows every write to the Player's Deck List: a hand edit or resolution gives the Deck List a new id and rolls the Player's `updatedAt`, which its `player:updated` carries, and the Screen reads again on every `tcgplus:imported`. A linked Slot side shows its Player's Deck List the same way, and a Screen showing that side may read the Players its Slot seats. A Player holding no Deck List shows nothing. A Screen with neither chosen still starts on the first Slot's left side; a Player chosen stays. Deleting the Player releases the Deck Source (ADR-0032).

**What OP Events now offer.** The Players, Metagame, Sync and Cards pages, and the Metagame, Most Played Cards, Archetype Spotlight and Top Cut Bracket Screen Modes, the last showing a Manual Bracket (ADR-0075). Standings, Pairings, Player History, Head-to-Head, Round Clock, Matches, Event Structure, Archetype Review and Integrations stay MTG-only.

### Why

ADR-0057 rested on TCG+ having no export. Its deck list export holds every Player's Leader and full 50-card Mainboard (512 of 512 in the Sydney Regionals sample), so a Feature Match can be picked from real Players with their decks attached, and the Metagame has every Deck List to count.

Keying OP cards by card number in the shared catalogue was rejected while nothing aggregated across OP Deck Lists. Metagame now does. One catalogue lets OP reuse the Player Deck List, Archetype and Metagame read model rather than maintain a parallel one. Card data is effectively static, so a card is fetched once and never refreshed. A single source keeps the catalogue from carrying two answers for one card.

The Nickname is the player's handle in Bandai's app, not the name the broadcast wants. Keeping it apart from the operator's name lets a re-import refresh one without touching the other. A cleared name falls back to the Nickname rather than showing blank, which an ADR-0046 Manually Edited Field would.

The Metagame is all or nothing: either the whole field was imported or no Metagame is worth showing. So every Player's Deck List counts, whether imported or entered by hand.

### Consequences

- **One lookup.** Imports, pastes and picked Leaders all resolve through bandai-keepr's bulk lookup (`POST /cards/collection`), at most 1,000 numbers a request.
- **Picking a featured match.** An OP Feature Match is picked from Players instead of typed. A Player featured in two Rounds no longer needs re-entering, as an unlinked side's competitor still does (ADR-0057).
- **No printing.** The export does not say which printing a Player registered, so every entry shows its card's standard printing.
- **Catalogue corrections.** A card bandai-keepr corrects stays as first fetched until the catalogue row is cleared. Nothing refreshes it.
- **No standings.** OP standings, records and Conversion Rate wait for a source. The export has none.
- **Duplicates.** A hand-added Player who later appears in an import is duplicated until the operator deletes one.
- **How the import lands.** `server/modules/tcgplus-import` reads the export by its Japanese headers, never by position, and refuses a file missing one (`422 TCGPLUS_EXPORT_INVALID`). It refuses a row naming a Player by a blank Nickname the same way, since an imported Player shows by nothing else, and cuts a Nickname to the 100 characters a hand-written one keeps. Preview and import each send the whole export, so the browser holds it between them; its routes take a body up to 4 MiB rather than the usual 1 MiB. The import resolves every card number in one lookup before writing, then writes the Players in one batch and the changed Deck Lists in a second (`opDeckListWriteModule().writeMany`). A failure between the two leaves the Players without their new Deck Lists, and a re-import finishes them. It announces one `tcgplus:imported` count rather than a `player:updated` per Player, as Melee Sync does, and still announces it, counting no Deck List, when the Deck List write fails after the Players committed.
- **The import's Deck List is kept.** Each import stores the Deck List it brought every Player (`tcgplus_imported_deck_lists`), so "Use imported Deck List" takes it at once rather than waiting for the next import.
- **Resolutions are remembered for the Event.** As Melee Sync's name overrides do, a resolution maps the misentered number to the card picked (`event_op_card_number_resolutions`), and every OP Deck List write in the Event, an import, a paste or a hand entry, reads the number as that card before its lookup. A re-import still holding the number saves the card picked, with no new Unresolved Deck Card, and changes nothing it had not changed. The mapping is recorded before the rewrite, so a rewrite failing part-way still holds for the next import. A retry records none, since its number is the card. The map holds for the Event even if bandai-keepr later learns the misentered number as a card of its own; resolving it again is the only way to change it, and nothing removes it.
- **One write for the Players' Deck Lists.** A retry or resolution rewrites every Player Deck List holding the number in one bulk write (`writeMany`), all or none, so its cost does not grow with the Deck Lists holding it; each Player is still announced by their own `player:updated`. A Slot side's Deck List is written on its own afterwards, so a failure there leaves the Players' rewritten; retrying finishes the rest.
- **No Archetype deleted by hand.** OP refuses it: an Archetype goes only when it is left without Players and not customised.

### Rejected alternatives

- **Separate OP deck tables with inline snapshots and their own Metagame read model.** Every Metagame, Archetype and Deck List Screen rule would be duplicated for OP.
- **Taking card fields from the export when bandai-keepr is missing a card.** Two sources would give one card two answers. The export has no cost, power or image anyway.
- **Refreshing every card on every import.** Card data barely changes, and the bulk lookup would grow with the field instead of with new cards.
- **The Nickname as the Player's name, with an operator's name kept as a Manually Edited Field.** A cleared name would show blank instead of the Nickname.
- **A pasted deck on a linked side as a Slot-only override.** The Metagame would count a different deck from the one on air.
- **Interpreting the export's status column.** Its meaning is unknown, and every row is a registered Player.
