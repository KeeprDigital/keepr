# ADR-0026: A live aggregate's epochs are ordered by its id

Accepted · 2026-10-19 · [#591](https://github.com/KeeprDigital/stream-keepr/issues/591)

### Decision

The Live State Follower orders epochs by aggregate id. Feature Match Sessions and Broadcast Graphics Live Sessions both take `AUTOINCREMENT` ids, which SQLite never reuses, so a later epoch always has a larger id. Anything from an older epoch than the one held is refused or dropped. A command result from a newer epoch is held, and so is a notification from one that carries its whole snapshot; a notification from a newer epoch that carries only a difference reloads.

A command result's outcome is explicit (`accepted`, and what is `held` now). A feature that merges an answer into rendered state merges what is held, so a refused late answer settles from the newer state instead of its own.

### Why

Issue #590 refused a command result from any different epoch, as Broadcast Graphics had. A Feature Match Slot Promotion answers with a Slot whose Session can be newer than the held one, and the Slot it clears gets one too. Refusing those would leave the promoting client on an ended Session. Falling back to holding them unconditionally would drop the guard #577 had to make up for server-side.

### Consequences

- Broadcast Graphics now drops a notification from an older Live Session instead of reloading, and would hold a command result from a newer one.
- A Slot whose Session is from an older epoch than the one held was read before a newer promotion or clearing of that Slot. The whole Slot is left behind, not only its Session, and a promotion answer whose Slot is left behind does not apply its Assignment either.
- A Slot settings answer and a Slot list load meet the same rule. The Event Data lifecycle takes an opt-in per-item `admit`, which the Feature Match store answers by offering the Slot's Session. A loaded Slot left behind keeps the held one in its place, and the rest of the load still applies. A settings answer left behind answers its caller with the held Slot (#635).
- A Slot with no Session is behind any Session held for that Slot, and is left behind whole the same way. No Feature Match path ends a Slot's Session without opening its successor in the same commit: every one replaces it through Sequenced Live State (ADR-0029), and none only closes it. So a Slot read without one was read before its first Session opened: between the Slot's insert and that open, on create or Slot count sync. While no Session is held for the Slot, it applies (#658).
- A path that ends a Slot's Session and leaves it with none would be refused by every follower holding that Session. Adding one needs an ordering signal other than the Session, and this decision has to be reopened first.
- A snapshot carried by another resource's read (a Slot's Session) is held through `acceptRead`, which supersedes no load: it was read at some moment, so a load in flight may answer newer. A load answering something behind what is held leaves it.
- An aggregate id from a table without `AUTOINCREMENT` cannot be followed: rowid reuse after deleting the newest row would order a new epoch before an ended one.

### Rejected alternatives

- **The adapter decides epoch order** — every feature would write the same comparison again, which is what the follower exists to prevent.
- **A newer-epoch command result goes through `acceptSnapshot`** — that skips every guard, so a late answer could not be told from a fresh one.
