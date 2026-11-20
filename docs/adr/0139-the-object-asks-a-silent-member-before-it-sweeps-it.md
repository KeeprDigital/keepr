# ADR-0139: The object asks a silent member before it sweeps it

Accepted · 2026-11-19 · [#1329](https://github.com/KeeprDigital/keepr/issues/1329), part of [#1310](https://github.com/KeeprDigital/keepr/issues/1310) · Amends ADR-0137 · Amended by ADR-0159: every socket is asked and swept, present or not, and the alarm runs while any socket is open

ADR-0137 sweeps a member whose pings stopped 45 s ago and closes its socket as stale. The client transport's ping is a timer, and a browser slows a hidden page's timers. A hidden member would be swept and reconnect about once a minute, and whoever watches it would see it leave and come back.

### Decision

**The object asks before it sweeps.** When a member has sent no ping for 30 s, two of a 15 s heartbeat, the object's alarm sends its socket one frame, `ask`, new to the wire protocol. It carries nothing.

**The client answers from the handler the frame arrives in, with a ping and no timer.** The runtime answers that ping as it answers any other, so the answer is recorded without waking the object, and the alarm reads it when it next looks. The answer waits for no pong, and is sent whether or not a ping of the heartbeat's is waiting for its own.

**The sweep stays at 45 s.** A member that answered is kept, and no watcher is told. One that did not, as a machine that lost power, is swept as before.

**The ask is at two thirds of the sweep unless a subclass states it** (`askMs`, beside `sweepMs`).

**The object remembers whom it asked in memory, and writes nothing for an ask.** A member is asked once for each silence. An object that slept after asking has forgotten it did; if something wakes it before that member's sweep, it asks once more.

**The alarm still runs only while anyone is present or held, and is set for its exact next need**: the earliest of a grace period's end, the ask of a member not yet asked, and the limit of one that was.

### Why

- **A message's handler is not a timer.** The hidden page whose timer fired once a minute handled every server message within 111 ms. So the question is put by the end whose clock runs, and answered where the browser does not delay.
- **A ping, not a frame of its own, is the answer.** The runtime answers a ping and keeps its time without waking the object. Any other frame would wake it once for each answer of each hidden member.
- **Two missed pings, not one.** One late ping is a busy page. Asking at 30 s leaves the 15 s before the sweep for the answer, which takes one round trip.
- **In memory, not in the attachment or storage.** Forgetting costs one more frame to a socket that then answers or is swept. Remembering would cost a write for every ask, and a hidden member is asked every 30 s.
- **The sweep is not lengthened instead.** Chrome's slowest timer is one a minute, so the limit would have to pass a minute, a member that lost power would stay in presence that long, and another browser's rule could be slower still.

### Evidence

Measured for #1329 in headless Chrome 153 over 8 minutes, on background tabs running a 5 s chained `setTimeout`:

| | Main-thread timer | Server message handled |
| --- | --- | --- |
| Hidden, socket open | Every 6 s for 5 minutes, then 20 s, 60 s, 60 s | Within 111 ms throughout |
| Hidden, no socket | The same | |
| Visible | Every 5 s throughout | |

An open WebSocket does not exempt a page. Chrome documents the rule: hidden for 5 minutes, a chained timer, no audio and no WebRTC, then once a minute (<https://developer.chrome.com/blog/timer-throttling-in-chrome-88>).

In local `workerd`, with the ask at 1 s and the sweep at 3 s: a member that pings only in answer stays past the limit with no watcher told, and the package's client transport does the same with a heartbeat that never fires; one that does not answer is asked once and swept at the limit; an answer given while the object sleeps does not wake it.

Not measured: OBS's browser source, Safari, Firefox. The throttled samples are three, on one machine. The ask has not been answered by a hidden page in a browser: the tests stop a heartbeat in Node. What the added alarms bill is not measured either.

### Consequences

- **The alarm runs more often.** While every member pings every 15 s, each alarm finds them all heard from within 15 s and sets the next for 15 to 30 s on, where it was 30 to 45 s. A member that only answers has two alarms of its own every 30 s, its ask and the look 15 s later that finds it answered, so members hidden at different moments each add up to four a minute.
- **An ask is a frame sent and nothing written.** A member that pings on time is never asked.
- **A client that does not know `ask` is swept as before.** The package's transport ignores a frame it cannot read.
- **A member that enters presence on a socket already silent for the sweep is still swept at once**, unasked, as before this decision.
- **A hidden page's retries are timers too.** #1318 measures them.
- **`packages/realtime/README.md` states the rule**, and `askMs` joins the object's timings.

### Rejected alternatives

- **A longer sweep.** The reasons above.
- **An answer frame of its own**, which the object would read. It wakes the object for every answer, and the ping already says what it would.
- **The ask kept in the socket's attachment.** It survives the object's sleep, for a write on every ask. What it saves is one repeated frame in the 15 s before a sweep.
- **Asking every member on every alarm**, with nothing remembered. An alarm that runs for one member would send a frame to every other still inside its 15 s.
