# ADR-0159: The realtime object bounds what one admitted socket can cost

Accepted · 2026-11-20 · [#1387](https://github.com/KeeprDigital/keepr/issues/1387) · Amends ADR-0137 and ADR-0139

The 2026-11-20 codebase review found no way to admit a socket without a ticket, and no way to forge the hand-off. It found that an admitted socket is trusted without limit. A `hello` could name one channel any number of times, and each entry replayed that channel's whole log before the attachment's size check discarded the answers: one socket allowed to hear a channel of 50 one-kilobyte messages sent a 62 KB `hello` naming it 2,000 times and was sent about 100 MB in one handler. A larger log exhausts the object's memory and resets it, which drops every socket of the scope.

### Decision

**A socket's frames are bounded before they are read.** A frame longer than 32 Ki characters, twice what a socket's attachment can hold, closes it with `CLOSE_TOO_LARGE` (4413) unparsed. A `hello` of more than 256 entries, its attaches, watches and entries together, closes it so before any log is read. A channel a `hello` names more than once is attached, and its log read, once. A socket's attachment is now written before its logs are read, so what it cannot hold costs no read.

**A socket has a frame budget**: 120 at once, refilled at 20 a second, in memory. A frame past it closes the socket with `CLOSE_RATE_LIMITED` (4429). A ping is the runtime's to answer and is not counted.

**One identity holds at most 32 sockets in a scope** (`socketsPerIdentity`). A newer one retires the oldest with `CLOSE_CROWDED` (4003).

**A socket has a maximum age**, an hour unless the app states another (`maxAgeMs`, and `realtime.maxSocketAgeMs` on the Nuxt layer). The alarm closes it with `CLOSE_EXPIRED` (4002); the client comes back within a second, and its caller is judged again by the app's port. Its member is held for the grace period, as a closed socket's is, so no watcher sees it leave.

**Every socket is asked and swept, present or not.** ADR-0139 asked and swept only members. A socket that holds no presence, whose peer vanished, was kept and sent every message until the runtime noticed. Now the alarm runs while any socket is open, and a socket silent past `sweepMs` is no recipient of a publish even before the alarm sweeps it.

**A publish is all or nothing.** Every delivery is checked first, a channel and a name and its data within ADR-0137's 64 KiB as JSON, and a call with one that is not throws `DeliveryError` before any is numbered, logged or sent. The numbering and the log are written in one transaction.

**The alarm prunes the log**, as a publish does, so a scope that goes quiet does not keep its last burst. **`disconnectAll` releases what the scope stored** once its withdrawal has run: its log, heads, withdrawals and epoch.

**A withdrawal may carry the version of what it spares.** Of two disconnects of one tag that spare numbered versions, the higher stands whichever reaches the object last. Stream Keepr passes a Screen Output Asset Capability's version.

**The object refuses a withdrawn grant with no socket of its own.** It answers the upgrade 403 with a marker, and `connectSocket`, in the app's Worker, answers the caller with the socket closed with `CLOSE_REFUSED`. A socket the object accepted would hold it awake until the peer completed the close.

**The client transport:**

- Each retry's wait is cut by a random part of up to a fifth of it, so clients cut together do not come back together. No wait is longer than ADR-0137's rhythm, so its ceiling of 30 s holds.
- A socket closed `CLOSE_SUPERSEDED` is retried after 2 s, inside the object's 5 s grace, where it was 5 s, at its end. `CLOSE_EXPIRED` is retried at a random moment within a second, since sockets accepted together expire together; `CLOSE_CROWDED`, `CLOSE_TOO_LARGE` and `CLOSE_RATE_LIMITED` from the 5 s step, with no refusal.
- The rhythm starts again once a socket has stayed up through a heartbeat, as well as once the object has answered on it: a socket that only holds hears only pongs.

**The Nuxt layer's hand-off** reads an app's 401 or 403 to the port's question as a refusal, the caller's Cloudflare properties reach the port, and under `nuxt dev` only the socket's path itself goes to the dev Worker.

### Why

- **Limits at the door, not at the store.** Each bound is checked before the work it bounds: a frame's length before it is parsed, a `hello`'s entries before a log is read, the attachment before the logs. The review's 100 MB came from work done and then discarded.
- **A code for each limit.** A client cannot tell a dead network from a limit by a 1006. Each code says what the client does next: come back at once to be judged, or slowly, because a quick retry would only meet the limit again.
- **Sweep every socket.** The alarm already ran every 15 to 30 s while anyone was present; a scope whose sockets only hear now pays the same, for not fanning out to the dead.
- **An hour's age.** Long enough that a reconnect each hour costs a page nothing it notices, short enough that a caller the app no longer admits is not kept for a show's length.
- **The highest version, not the latest arrival.** Two regenerations race through two requests; the object cannot know which the app made last, but the app numbers its credentials.

### Consequences

- **The alarm runs while any socket is open**, every 15 to 30 s, where it ran only while anyone was present or held (ADR-0139). What it bills is not measured.
- **A page with more than 32 sockets of one identity in a scope** sees its oldest leave and come back every 5 s or so. None does today.
- **A message over 64 KiB now throws**, where it was sent. Stream Keepr's are notifications, far within it.
- **A socket's identity is in its attachment**, as a digest. A socket accepted before this has none, and is not counted against its identity.

### Rejected

- **Answering an over-large `hello` with a refusal for each channel**: it would be the amplification again, smaller.
- **A refused socket accepted by the object for hibernation**: a close sent before the upgrade's answer reached the peer late, if at all.
- **Waiting out short timings in the tests**: a busy machine outlasted them. The tests move the object's clock instead.
