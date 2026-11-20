# ADR-0146: Deleting an Event closes every realtime socket of its object

Accepted · 2026-11-20 · [#1351](https://github.com/KeeprDigital/keepr/issues/1351), part of [#1310](https://github.com/KeeprDigital/keepr/issues/1310) · Amends ADR-0144 · Amended by ADR-0162

ADR-0144 closed a deleted Screen's outputs' sockets, and recorded as a consequence that deleting an Event did not: its Screens go by the database's cascade, not through the Screen's delete, so its object kept whoever was connected, Screen Outputs and operators' pages, until each dropped. None can return: the port refuses an Event that does not exist, and the Realtime Tickets went with the Screens. But a Screen Output that stays present keeps the object's alarm waking it about every 15 s, and the output is never told its Event is gone. An operator's page is told, by `event:deleted`, and leaves.

### Decision

**Deleting an Event disconnects every socket of its object**, whatever let it in, once the delete has committed and after `event:deleted` is published. The object had no call for that: it closes by tag, a Session's tag is its User, and a User's sockets on other Events are not this delete's. So `@keepr/realtime` gains `disconnectAll()`, which withdraws everything the scope granted as `disconnect` withdraws a tag: it closes every socket with `CLOSE_REFUSED`, ends every member's grace period and clears the alarm, and for `withdrawalMs` lets in no socket at all.

**A disconnect that fails does not fail the delete.** It is tried twice, and then the server logs `event_realtime_disconnect_failed` with the Event. The Operator is not told: there is nothing for them to do again.

### Why

- **After `event:deleted`, not before.** An operator's page leaves on it, and a socket hears what was sent it before it closes; closed first, the page would hear nothing and only be refused.
- **Last of what follows the commit**, which ADR-0144's "first of what follows" does not contradict: the Screen Cards' cleanup and the announcement before it never throw, so nothing can leave the sockets open.
- **A call for everyone, not a tag every grant carries.** A tag for the Event would spend one of a grant's nine on what the scope already says, and the object's scope is the Event; a call that names nobody is the object's own concept.
- **It withdraws, as `disconnect` does**, so a socket the port let in just before the delete, which reaches the object just after, is refused there.

### Consequences

- **For a minute after, the Event's object refuses every socket.** An Event's id is never given to another (its key is `AUTOINCREMENT`), so this refuses nobody who should be let in.
- **A Screen Output on a deleted Event is refused at once**, where it was refused only when its socket next dropped. It holds what it shows, as ADR-0022 has it, and retries its ticket at the slow rhythm, refused each time.
- **The object keeps its storage**: its channels' logs age out as ever, and nothing wakes it.
