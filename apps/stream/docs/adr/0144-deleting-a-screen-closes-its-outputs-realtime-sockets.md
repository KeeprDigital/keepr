# ADR-0144: Deleting a Screen closes its outputs' realtime sockets

Accepted · 2026-11-20 · [#1347](https://github.com/KeeprDigital/keepr/issues/1347), part of [#1310](https://github.com/KeeprDigital/keepr/issues/1310) · Amends ADR-0142

ADR-0142 closed a Screen's realtime sockets when its Screen Output Asset Capability is regenerated, and recorded as a consequence that deleting the Screen did not: its Realtime Tickets go with it, so no output returns, but one already connected stayed on a channel of a Screen that no longer exists until its socket dropped.

### Decision

**Deleting a Screen disconnects its outputs' sockets**, by the tag `screen-output:<Screen id>` in the Event's object, once the delete has committed and before anything else that follows it. Nothing is spared: no capability replaces the one that went.

**A disconnect that fails does not fail the delete.** It is tried twice, and then the server logs `screen_output_disconnect_failed` with the Event and the Screen. The Operator is not told, where a regeneration tells them (#1349): there is nothing left for them to do again.

### Why

- **A deleted Screen's output is still counted** by whoever watches its presence, until it drops. The delete is the moment an Operator expects it gone.
- **After the commit, not before**, as ADR-0142 has it for a regeneration: a socket closed while its Screen still exists is let straight back in.
- **First of what follows**, so a failure to clean the Screen's Card or to announce the delete does not leave the sockets open.

### Consequences

- **For a minute after, the Event's object refuses a socket tagged with that Screen** (`withdrawalMs`, `packages/realtime`). A Screen's id is never given to another, so this refuses nobody who should be let in.
- **Deleting an Event does not close its sockets.** Its Screens go by the database's cascade and not through this, so its object keeps whoever is connected, outputs and Sessions, until they drop. None can return: the port refuses an Event that does not exist, and the tickets went with the Screens. Not changed here.
