# ADR-0162: Realtime recovers a lost publish, and judges a changed listener again

Accepted · 2026-11-20 · [#1389](https://github.com/KeeprDigital/keepr/issues/1389) · Amends ADR-0142, ADR-0143, ADR-0144 and ADR-0146

The review of the cutover from Ably to each Event's object (#1310) found four
things the cut left loose. A publish that failed twice was lost, and a Screen
Output re-read only while realtime was degraded, so program could stay stale
until the next message. A page's socket was judged once, on what the page held
when it opened, and kept through a change of what it holds. An output that can
never be let in again asked every 15 to 30 s forever, and each ask wrote to D1.
And a Session renewed on a socket's admission never reached the browser
(ADR-0142's consequence).

The object's own half, a socket's maximum age and withdrawals that cross, is
ADR-0159's (#1387). Stream Keepr sets that age here.

### Decision

**A socket is judged again every five minutes.** Stream Keepr sets the
object's maximum socket age (`realtime.maxSocketAgeMs`, ADR-0159) to five
minutes, the life of an Identity Proof: a Session ended, or a User who lost App
access, since a socket was let in is refused when it comes back, as every REST
request is within that time. An integration server's age is 15 s, so its suite
can watch one expire.

**A publish that fails twice is tried again after the write answers**, where
the request can finish work then (`waitUntil`): after 1 s, 5 s and 15 s, 21 s in
all, inside the 30 s a Worker keeps it. Only the last failure is logged. This
holds for an Event message published best-effort (`publishMessage`) and for the
Screens' call. A strict publish, and a Screen command, still fail to their
caller after two calls: the caller judges. With no request to finish after, as
in a scheduled tick, a publish is still made twice and then logged.

**A Screen Mode re-reads every two minutes while realtime is healthy**, so a
publish lost after its retries leaves program stale for two minutes at most.
One timer serves every cadence, counted from the latest read.

**What cannot be let in again backs off.** A Screen Mode whose reads keep
failing re-reads at the slow cadence for a minute, then twice as long each
time, up to every five minutes. A page refused a Realtime Ticket four times in
a row is refused again without asking, for a minute, then twice as long each
time, up to ten minutes; the transport's retries go on, and cost the server
nothing meanwhile. A capability the page now holds instead is asked for at
once. The ticket route reads before it writes, so a refusal writes nothing.

**A page whose credential changes is cut and admitted afresh.** What a page
presents is read as it asks anything of its Event: its Screen Output Asset
Capability, or its Session. A change cuts the Event's socket, and the next is
asked its address again (`reconnect()` of `@keepr/realtime/client`), keeping
everything asked. A grant is fixed for a socket's life, so this is the only
way a Screen Output that changes Screen hears its new Screen.

**An Event the page has left is forgotten.** Leaving an Event closes its
socket and ends everything asked there. Asking something of it again does not
take the page back: a component of the page it left may still be tearing down,
and a page that left a deleted Event must not reopen its socket. Only the room
(`setRoom`) takes a page back to an Event it left; what was asked of it since,
by a component that mounted before its page's room was set, is made then.

**A socket's port asks who its caller is without taking a renewed Session.**
The upgrade's answer is the runtime's, so a cookie taken there never reaches
the browser. The shared layer's resolver takes `passesCookies: false` and keeps
what Keepr Accounts renewed with the Identity Proof, for the next answer that
does reach the browser.

**A Screen Output of a deleted Screen holds its last frame.** Its sockets close
before the delete is announced (ADR-0144), so it is never told; on its next
socket it is refused, and it holds what it shows, as a refused output does
(ADR-0143, ADR-0146). The `screen:deleted` handler on a Screen's channel stays:
a rendering opened with a Session, whose socket the delete does not close,
hears it.

**A wipe or a restore of the database first ends every Event's realtime**,
through `POST /api/admin/realtime/end-events`, as deleting each Event does:
`event:deleted`, then every socket closed. Either hands out again ids the
database issued, and an Event's object is named by its id.

### Why

- **After the answer, not before.** A deploy resets an object for longer than
  two calls take, and a write must not wait on realtime. A Worker keeps
  `waitUntil` work 30 s, which bounds the waits.
- **A retry can land after a newer message.** A record a page replaces by id
  could then go back a step until its next resync. A lost message leaves it
  stale the same way, for longer, and the healthy re-read bounds both on
  program.
- **Two minutes**, because the healthy re-read costs every output a read
  however quiet the show, and a lost publish needs a failure of the object
  three retries long.
- **The page decides when its credential changed**, since only it knows what
  it holds; the object could only expire the socket on a timer.
- **The room, not any ask**, takes a page back to an Event, because the room is
  the page's own word for where it is.

### Consequences

- **The write's timing line counts what was done before the answer**; a retry
  and the Screens' notices after it are in no line (`README.md`).
- **An operator's page can show a retried message out of order** until its next
  resync. Accepted, above.
- **A Screen Output that returns to an Event it left without a room is deaf.**
  None does: an output is opened on one Event by its URL.
- **Before a wipe or a restore, a Graphics Administrator runs the end-events
  call** (`README.md` § Ending every Event's realtime).
