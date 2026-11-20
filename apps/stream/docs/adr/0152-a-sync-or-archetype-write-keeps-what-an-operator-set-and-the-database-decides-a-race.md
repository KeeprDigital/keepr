# ADR-0152: A sync or an Archetype write keeps what an Operator set, and the database decides a race

Accepted · 2026-11-20 · [#1378](https://github.com/KeeprDigital/stream-keepr/issues/1378). Amends ADR-0052, ADR-0085 and ADR-0087.

### Decision

**A Melee Sync answer that says nothing about a thing leaves it as stored.** A Deck List sync leaves the Archetype, deck name and deck colours of a Player Melee holds no Deck List for, and moves only the Players it changes. A Player absent from a standings answer that names others keeps their stored record; before Round 1, when Melee names nobody, every Player has played nothing. A complete Round with Matches whose standings answer is empty is refused as an invalid snapshot, keeping its stored Round Standings and Matches, as an empty Match answer is.

**Unresolvable card names cost a sync little.** A front face the collection lookup answered with its card resolves there. A name a sync stored as an Unresolved Deck Card is not looked up one at a time again, and a sync looks up at most 25 names one at a time, leaving the rest unresolved for a later sync or the Operator.

**A Live Results run reads the time per Event and has a budget.** Each tick takes its lease and poll state from its own time, and a run starts no tick 30 seconds after it began, so it is done before the next minute's run reads the due Events.

**The database decides a race for a name.** An Event's Archetype names are unique ignoring case and surrounding spaces at the database (`archetypes_event_name_key_idx`); a create or rename losing a race answers 409 as the check does, and so does a Screen slug race. A unique-index refusal is read wherever Drizzle wraps it. Only a marked State Conflict is a lost race a caller may absorb; any other 409 is a refusal.

**A Commander Event refuses what it does not have at each write module.** Player, Player List, Round, Match, Feature Match Assignment, promotion and Archetype writes refuse it, whatever route or caller reaches them.

**An Archetype merge or delete reaches every Player who held it**, a Player holding it without a Deck List included: they are named with the re-projected Players in one `player:deckProjectionsChanged`, and their Feature Match Slots re-synced.

### Why

Each defect replaced something an Operator set, or a stored record, with an upstream answer that did not speak to it, or let two writes race past a check into a 500. The case-insensitive index cannot be built over names an Event already holds twice in another case, which ADR-0085 left in place: the migration keeps each first and renames the later ones with their id, so none is lost and the Operator can merge them.

Contradicts ADR-0085's "the unique index stays case-sensitive": reopened because a check without the index lets a concurrent create through.
