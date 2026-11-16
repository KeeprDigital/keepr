# ADR-0075: A Top Cut Bracket may be a Manual Bracket its Screen holds, and One Piece Card Game Events show one

Accepted · 2026-11-05 · Changes ADR-0057 and ADR-0074 · Compatible with ADR-0047 · Amended by ADR-0077: a Player shows by name or by Nickname, as the Screen's `Show Players by` setting picks · Amended by ADR-0087: Top Cut Bracket is not offered to a Commander Event

A One Piece Card Game Event's top cut runs in Bandai TCG+, which exports no pairings or results (ADR-0057, ADR-0074), so Stream Keepr holds no Phase to derive its Top Cut Bracket from. Operators still want the graphic on air, filled in as the cut is announced and played. A Magic Event not run on Melee.gg has the same gap.

### Decision

**A Top Cut Bracket Screen reads its bracket from a Phase or from its Manual Bracket.** `bracketSource` (`phase` or `manual`) chooses. The choice not taken is kept, so switching back restores it. A One Piece Card Game Event holds no Phases, so its bracket is always its Manual Bracket, whatever `bracketSource` says (`topCutBracketSource`). The server read and the output's freshness both decide the source by that one rule. Top Cut Bracket is offered to both Card Games (`SCREEN_MODE_OFFERED_TO`).

**A Manual Bracket is Screen config.** `manualBracket` holds three things:

- its size (4, 8, 16 or 32);
- its entrants by Seed, Seed 1 first, each a Player of the Event (`{ playerId }`) or a typed name (`{ name }`), `null` for a Seed not entered;
- the results marked in each column by position, each naming the side that advanced (`winner`) and, optionally, a game score (`gameWins`).

The schema refuses more Seeds than the size, or more columns or positions than the size holds. Every edit writes the whole Manual Bracket through the Screen write, so it reaches the output as every Screen config edit does, live. A display reset keeps it, with `bracketSource` and `phaseId`.

**The bracket is derived from it purely** (`deriveManualTopCutBracket`, `shared/modules/top-cut-bracket/manual.ts`):

- The first column pairs the Seeds in standard order (1v8, 4v5, 2v7, 3v6 for 8), the same order a Phase's Seeds are placed in.
- An empty Seed is a bye for the entrant it meets. A position no entrant can ever reach passes a bye on to whoever meets it in the next column.
- A result counts only at a position seating both its entrants. Each later column seats the entrants advancing into it, and the Final's winner is champion.
- Columns are named by size (Quarterfinals, Semifinals, Final). The output renders it with the same Display as a Phase's bracket.

**A mark is held by its position and side, not by who sat there.** Correcting an entrant keeps every result, so the corrected entrant takes the place and the wins. Resizing keeps each entrant's Seed (dropping those past the new size) and clears every result, since every column moves to another position.

**A Seed naming a Player is an Event Reference.** The `manualBracket` kind requires each named Player to belong to the Screen's Event (ADR-0038). Deleting a Player, alone or through a Melee data reset, empties each Seed naming them in the same batch (`buildReleaseManualBracketPlayersQuery`), keeping every other Seed and every result, and announces the Screen without an origin, as ADR-0032 does for a Deck Source. A Screen left naming a deleted Player could otherwise never be written again.

**An entrant shows as Top Cut Bracket shows any entrant.** A Player shows by their current name, or their Nickname (ADR-0074), and their Archetype or Deck List's deck name while Archetypes show. A typed name shows as typed, with no deck. A Seed is shown as the entrant's place in the operator's list, while Seeds show.

### Why

The bracket is a broadcast graphic, and the operator knows the cut before Stream Keepr could. TCG+ shows the top cut's Seeds in order, so listing them in that order reproduces the bracket with the fewest clicks. Marking who advanced is the only input each match needs, and a score is optional because most One Piece top-cut matches are best of one.

ADR-0047 removed operator-entered Match Results because they reached Player history, Pairings, Head-to-Head and Top Cut Bracket while Melee's standings never counted them, so the two disagreed. A Manual Bracket's results are not Match Results. They are held on the one Screen that shows them, and no record, history, standings, Head-to-Head or Metagame reads them, so there is nothing for them to disagree with.

### Consequences

- Two Screens showing one top cut each hold their own Manual Bracket, and the operator fills in both.
- A Manual Bracket on a Magic Event never follows Melee. Switching the Screen to its Phase does.
- A re-seeded or corrected entrant keeps the results at their Seed's positions. The operator clears a result by picking its winner again.
- Nothing announces a Manual Bracket edit beyond the Screen write's own `screen:updated`. The output re-reads because the read's source key holds the Manual Bracket, and re-reads on `player:updated`, `player:deleted` and `tcgplus:imported` for the Players it seats.
- `test/unit/shared/manualTopCutBracket.test.ts` pins the derivation and the edits, `test/unit/shared/manualBracketSchema.test.ts` the schema's bounds, and `test/unit/server/services/manualTopCutBracket.sqlite.test.ts` the read, the source rule and the release on delete.

### Rejected alternatives

- **Manual Rounds and Matches for One Piece Card Game Events, with operator-entered results.** It reopens ADR-0047 and ADR-0057 for a whole structure nobody keeps up during a stream, to feed one graphic.
- **A Manual Bracket held by the Event, shared by its Screens.** It needs a table, a write module and its own announcements for something only a Screen shows. Revisit if operators run two Screens of one cut.
- **Results held by entrant, so a correction moves them.** A typo fix would lose the result, and a swapped Seed would carry wins to a position the entrant never played.
