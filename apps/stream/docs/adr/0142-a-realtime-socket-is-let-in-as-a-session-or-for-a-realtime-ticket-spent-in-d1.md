# ADR-0142: A realtime socket is let in as a Session, or for a Realtime Ticket spent in D1

Accepted · 2026-11-19 · [#1315](https://github.com/KeeprDigital/keepr/issues/1315), part of [#1310](https://github.com/KeeprDigital/keepr/issues/1310) · Amends ADR-0010 and ADR-0141

ADR-0137 decided who may open a realtime socket: a Session by its cookie, with the upgrade's `Origin` checked as the Session boundary checks a state-changing request, and a Screen Output by a short-lived ticket that admits one socket, given for its Screen Output Asset Capability. #1315's contract fixed the socket's address, each caller's scope and grant, and the ticket's route, lifetime and answers. Neither said where a ticket is kept, what it is bound to, how the `Origin` rule is applied to a GET, what a socket that presents both credentials is, or what happens when a capability's sockets cannot be closed. The ticket and the `Origin` check were not prototyped (ADR-0137).

### Decision

**A Realtime Ticket is a row in D1, `realtime_tickets`, deleted by the statement that reads it.** The port spends a ticket with one `DELETE … RETURNING`, which also answers whether the capability the ticket was given for is still its Screen's. Two sockets that present one ticket at once run that statement one after the other, and the second deletes nothing. A ticket presented is spent whatever the socket is answered: for another Event, expired, or after its capability was regenerated.

**The row binds the ticket to its Event, its Screen and the digest of the capability it was given for.** It admits only while a Screen with that id, in that Event, still holds that digest. So regenerating a capability leaves its unspent tickets admitting nobody with no second write, and deleting the Screen or the Event deletes them.

**Giving a ticket is one statement too**: an insert that selects the Screen whose capability digest was presented, in the Event asked for. No row is written for a capability that is no Screen's or a Screen's of another Event, and the route answers both, a missing capability and an unreadable Event id with the same 401.

**Only a digest of a ticket is stored**, SHA-256, as a capability's is. A ticket is 32 random bytes, base64url.

**Expired tickets are deleted when the next one is given**, in the same batch. The table holds what was given in the last 30 s, and nothing is scheduled.

**A socket that presents a `ticket` is judged by the ticket alone.** The port never reads the Session of such a socket, so a refused ticket is not made good by a cookie the same browser carries.

**A Session's upgrade is checked by `requestIsCrossSiteMutation`, as a POST.** The port calls the function the Session boundary calls, with the method fixed to one that changes state: the rule admits every GET, and an upgrade is one. It is asked before the Session is read. A socket with neither `Sec-Fetch-Site` nor `Origin` is admitted, as the boundary admits a script.

**Whoever is not let in is answered `null`**, which the layer answers with a socket closed `CLOSE_REFUSED`: a signed-out visitor, a User with no App access, another origin's page, an Event that does not exist or is not named, and every refused ticket. **A caller who could not be judged is neither let in nor refused**: when Keepr Accounts cannot be asked, or D1 does not answer, the port throws, the layer passes the server's 5xx on, and a page reads a failed attempt and tries again. No path that throws admits.

**The disconnect is called by the capability's manager**, `rotate` in `server/modules/screen-output-assets/manager.ts`, after the write that stores the regenerated capability has answered with its row, and never when that write did not land. It closes the sockets tagged `screen-output:<Screen id>` in the Event's object.

**A disconnect that fails does not fail the regeneration.** The capability is already regenerated and nothing can undo that. The disconnect is tried twice, and then the server logs `screen_output_disconnect_failed` with the Event and the Screen, saying outputs opened under the former capability may still be connected and that regenerating again closes them. The route still answers the new capability.

### Why

- **D1, because spending must be exact.** One statement decides in SQLite's own order. KV is eventually consistent and has no conditional delete, so a spent-list there admits both sockets of a race. The object could hold tickets, but the port answers before any object is named, and the layer's port is the one place a caller is judged (ADR-0137).
- **The capability's digest in the row, not a sweep on regeneration.** A check in the spending statement cannot be forgotten by a second way of changing a capability, and needs no write the regeneration could fail halfway through.
- **A ticket decides alone**, because the two grants differ. A Screen Output whose capability was regenerated, in a browser that is also signed in, would otherwise come back as its Operator: with every Screen's channel, under an identity regenerating the capability does not close. Locally the Accounts Stand-in vouches for a request with no cookie, so falling through would let every refused ticket in.
- **The boundary's own function, not a second rule.** What "another origin" means, and why the scheme is not compared, is decided once (ADR-0010). The port states only that a socket is not a safe read: the page that opened it reads everything it carries.
- **A failure is not a refusal.** A refusal tells a page it may not, and its transport slows its retries (ADR-0137). A Keepr Accounts outage says nothing of whether the caller may, and every route behind the Session boundary answers it 503 too.
- **The manager, not the route.** The manager is where a capability is regenerated, so every caller of `rotate` closes the sockets, in an order one function states.
- **Log and answer, not a 5xx.** An error would tell the Operator the capability was not regenerated, when it was, and withhold the new one. The sockets left open hear only their Screen's channel, read nothing with a capability that is gone, and cannot return once they drop.

### Rejected alternatives

- **A spent-list in KV**, or the ticket as a signed, self-describing value with one. See Why: no exact spend.
- **Spending in the object**, as its first frame. The layer hands a socket over already granted; a second judgement inside the object would be a second way in.
- **Deleting a Screen's tickets when its capability is regenerated.** Redundant with the digest check, and one more write to order.
- **Falling through to the Session when a ticket is refused**, as `GET /api/realtime/token` does for a capability. See Why.
- **`optionalIdentity` for the Session**, which answers `null` while Keepr Accounts cannot be asked. It would turn an outage into a refusal.
- **Failing the regeneration when its sockets cannot be closed.** See Why.

### Consequences

- **`/api/realtime/ticket` is outside the Session boundary**, an exact path beside `/api/realtime/token`. It reads no Session.
- **A socket let in during a regeneration can outlive it.** The port reads the capability and answers; the layer then hands the socket to the object. A regeneration that commits and disconnects between the two does not close that socket. The gap is the hand-off's own, a few milliseconds, and closing it needs the object to know when a grant was decided: it is the layer's to close, not this route's.
- **A Session cookie Keepr Accounts renews on the port's question is not passed to the browser.** The layer's resolver hands a renewed cookie to the next request that asks, once, and the hand-off reads the port's answer and drops its headers. When that request is a socket's, the browser keeps the cookie it had. It is the layer's to pass on.
- **Deleting a Screen does not close its outputs' sockets.** Its tickets go with it, so none returns.
- **The Ably token route is untouched** and keeps its own grant until the pages leave Ably (ADR-0140).
