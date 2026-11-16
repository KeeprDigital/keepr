# ADR-0084: An Archetype rename or delete announces the Players it re-projected in one message that names them

Accepted · 2026-11-12 · [#1141](https://github.com/KeeprDigital/stream-keepr/issues/1141)

### Decision

**Renaming or deleting an Archetype publishes one `player:deckProjectionsChanged`** for the Players whose Archetype projection it re-ran: those whose primary Deck List holds the Archetype. The message names them (`playerIds`) and carries none of them. It goes out once the bulk write commits, under the writer's origin, before `archetype:updated` or `archetype:deleted`, and not at all when no Player was written. No `player:updated` is published on this path. `player:updated` itself is unchanged: a single Player edit and a deck review still publish it, carrying the Player.

**It is one Event Data change.** One publish on the Event's channel, one telling of the Screens, one re-resolution of Graphic Input Bindings. The Reverse Sync that follows is as it was.

**Every consumer of the per-Player messages follows it:**

- **An operator browser re-reads the Event's Players** and invalidates its Metagame pages, as it does on `melee:playersSynced`. It still applies the projection itself on the Archetype's own message, for the Players whose decks it has loaded. The browser that made the change skips its own message, as it skipped its own `player:updated`.
- **A Player history re-reads** when the message names its Player or an opponent it holds.
- **A Screen Output is told a `player` change naming those Players**, so exactly the Screens a `player:updated` for one of them reached are told, once. A preview applies the same rule to the message itself.

**A message too large to name its Players names none.** Where the ids would take the message past `MAX_REALTIME_MESSAGE_BYTES`, it is published with `playerIds: null`: any Player may have changed. An operator re-reads the Players either way; a Player history re-reads; every Screen following Players is told, as on a sync. So the message is bounded by construction and `realtime_publish_oversized` cannot fire for it, the same fallback ADR-0004 gives a Live Session notification.

### Why

The write was already one batch (#1039). Its announcement was one `player:updated` per Player, each a publish to Ably made in sequence inside one Worker invocation: 400 for an Archetype 400 Players hold. Nothing had measured that against the Worker's subrequest limit, and a refused publish is logged and skipped, so some peers could be left untold of some Players.

The ids fit where the Players do not. A `PlayerResponse` is several hundred bytes, so a few hundred pass 64 KiB. An id costs its digits and a comma: 400 Players weigh about 3 KB, and the limit holds some 8,000 seven-digit ids. An Archetype held by more Players than that is not an Event this app has seen, but the publisher cannot rule it out, and an oversized publish is refused silently. So the fallback is by size, measured over the whole message as `realtimeMessageBytes` measures it, not by a count.

A re-read is what a peer already does for a bulk Player change (`melee:playersSynced`, `tcgplus:imported`). ADR-0031 took the same shape for a resolved Unresolved Deck Card, and rejected one `player:updated` per Player for the same cost.

### Consequences

- A peer operator's Player list is re-read once per rename or delete, where its rows were replaced one by one. The maintainer accepted that on #1141.
- An operator browser on a page that never loaded the Players loads them on this message, as on `melee:playersSynced`.
- A preview's held Players (`playerStore.holdPlayer`, ADR-0022) are no longer patched by a message on this path. Its operator's re-read replaces them, and its mode re-reads on the `player` change.
- The message does not say what changed on a Player. A consumer needing the new Archetype, deck name or colours reads the Player.
- The same per-Player loop remains in the One Piece Card Game bulk Deck List write (`writeMany` with `announcePlayers`, ADR-0074), which still publishes one `player:updated` per Player. This message's handling would serve it: the operator re-read and the `player` change are what its consumers need. Its name would not, since that write replaces a Player's Deck List and not only their Archetype projection.
- `test/unit/server/modules/archetypeChangeAnnouncement.sqlite.test.ts` pins what reaches the Event's channel for 1, 3 and 400 Players, the order against the Archetype's message, and both sides of the size bound.

### Rejected alternatives

- **Carry the Players.** A peer would patch its rows without a read, but a few hundred do not fit one message, so the common case for a popular Archetype would be the fallback.
- **Split the ids across several messages.** Past the bound a peer re-reads the Players whatever the ids say, so a second message buys only narrower Screen tellings, for a case not yet seen, and gives up "one message, whatever the number".
- **Leave it to the Archetype's own message.** An operator browser already projects from it, but only onto Players whose decks it has loaded, and a Screen following Players and not Archetypes would hear nothing.
