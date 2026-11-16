# ADR-0032: Deleting a Player releases every Deck Source that selects them

Accepted · 2026-10-20 · [#651](https://github.com/KeeprDigital/stream-keepr/issues/651)

### Decision

**A Player selected as a Deck Source can be deleted, and the delete clears that Deck Source to no Player in the same write.** `buildClearDeckSourcePlayersQuery` rewrites each Screen in the Event whose Deck Source names a deleted Player, and bumps its `stateVersion`. It runs in the same batch as the delete, ahead of it. Both paths that delete Players use it: deleting one Player, and the Melee data reset, which deletes every imported Player.

**Each cleared Screen is announced with `screen:updated`, ahead of the delete's own announcement and without an origin.** The deleting client never received those Screens back, so it must not skip the announcement as its own echo. A Deck List Screen Output then follows its Screen to no Player, blanks through the staged swap, and stops reading the Player. A `melee:dataReset` that arrives before the Screen reload lands can still cost one failed read, and its retry stops once the reload lands.

**Contradicts ADR-0030, which says every Screen write passes through `screenWriteModule()`.** The clear is part of the Player delete's write, and it has to commit in the same batch as that delete. Routing it through the Screen write module would split it into a separate write per Screen.

### Why

The Screen guard triggers prove that a Deck Source's Player exists whenever a Screen's `mode_configs` is written. Nothing ran when the Player went away. A Screen left naming a deleted Player failed every later configuration write with `SCREEN_DECK_SOURCE_CONFLICT`, including edits to other modes, and its Deck Output kept the deleted deck on air while re-reading it every 15 s.

No Player is already a valid Deck Source, and a Screen with nothing selected is what an operator would get by deselecting first. A Broadcast Deck List is different: someone prepared it for display, so a selected list is protected from deletion. A Player is tournament data, and the Melee data reset deletes Players as a side effect of moving its configuration.

### Consequences

- An operator form that read the Screen before the delete gets a `stateVersion` conflict on its next save, as for any other concurrent Screen write. That includes a Graphics Authoring Lease holder, because the clear ignores the lease. The lease protects nothing the clear changes.
- A delete that finds no Player still clears a Deck Source naming that id, and announces it.
- Screens that already name a missing Player are not repaired by a migration. Such a Screen accepts a write that selects another Deck Source, and deleting that Player id again clears it.

### Rejected alternatives

- **Refuse to delete a selected Player, as a selected Broadcast Deck List is refused.** The Melee data reset would then have to refuse a configuration change too, or delete around the Screens. Either way, operators would have to hunt for Screens before changing Melee configuration.
- **An `AFTER DELETE` trigger on `players`.** It would cover every path without code, but the service could not say which Screens changed, and they still have to be announced.
