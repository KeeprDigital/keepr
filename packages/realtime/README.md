# @keepr/realtime

Realtime for every app in the workspace (ADR-0137, in the root `docs/adr`): one
Durable Object per scope an app names, holding every socket of that scope, and
the client transport that reconnects to it. It knows channels, sockets and
presence. It names no product: an app supplies the scope, the channel names and
who may hear and enter what.

| Import | What |
| --- | --- |
| `@keepr/realtime/protocol` | The frames both ends speak, and the close codes |
| `@keepr/realtime/object` | The Durable Object class an app's Worker exports |
| `@keepr/realtime/client` | The client transport, with no framework in it |

## The object

`RealtimeObject` (`src/object`) is one scope's realtime: every socket of the
scope, a sequence and a catch-up log per channel, and presence. A channel is an
opaque string. An app's Worker exports the class, binds it as a SQLite-backed
Durable Object, and names one object per scope:

```ts
import { connectSocket, refuseSocket, RealtimeObject } from '@keepr/realtime/object';

export { RealtimeObject };

// In the Worker's fetch, for the socket's route:
const grant = whoIsThis(request); // the app's own rule
if (!grant) return refuseSocket();
return connectSocket(env.REALTIME.getByName(scope), request, grant);

// Anywhere the app writes:
const [{ seq }] = await env.REALTIME.getByName(scope).publish([{ channel, name, data }]);
// When a credential is withdrawn:
await env.REALTIME.getByName(scope).disconnect(tag);
```

| Export | What |
| --- | --- |
| `RealtimeObject` | The class. `publish(deliveries)` answers each delivery's `seq` on its channel and the `recipients` it was sent to; `disconnect(tag)` answers how many sockets it closed. |
| `connectSocket(stub, request, grant)` | Hands a socket's upgrade to a scope's object with what the app grants it. The only way in. |
| `refuseSocket()` | Answers an upgrade the app refuses: an accepted socket closed with `CLOSE_REFUSED`, which a page can read where it cannot read a 403. |
| `Grant`, `Delivery`, `PublishAnswer`, `RealtimeObjectOptions`, `RealtimeObjectStub` | Their types. |

### The grant

The app decides who the caller is; the object enforces what it was told.

| Field | What |
| --- | --- |
| `identity` | Who the caller is, in the app's terms. A client id replaces only sockets of the same identity. |
| `hear` | The channels it may attach to, and whose presence it may watch. |
| `enter` | The channels it may enter presence on. None when left out. |
| `tags` | Names `disconnect` can close it by, fixed when the socket is accepted. At most 9, of 240 characters. |

A channel is named exactly, or by a prefix ending `*` (`room:12:*`). An attach,
watch or enter outside the grant is answered with `refused` and changes
nothing; so is one that would put a socket past the 16 KiB the runtime lets it
hold. A grant the object cannot hold throws from `connectSocket`: it is the
app's defect.

The grant goes to the object by RPC and answers a ticket for one socket, which
the upgrade carries. The object reads nothing else of the request, so nothing a
caller sends is taken for a grant, and a request that reaches it any other way
is answered 403. The URL carries only the client's id (`CLIENT_ID_PARAM`).

### What it does

- **Fan-out and order.** A publish gives each delivery the next sequence of its
  channel and sends it to the sockets attached there. One call's deliveries, and
  every call's, are heard in the order published, across channels.
- **Catch-up.** An attach that carries the sequence it held and the epoch it
  came from is replayed what followed, marked `replayed`. It is `resumed` only
  when nothing between that sequence and the head was pruned and the epoch is
  this storage's; otherwise continuity was lost and the consumer re-reads.
- **Heartbeat.** A `ping` is answered `pong` by the runtime, without waking the
  object. Every client pings, and answers an `ask` with one more.
- **Presence** is held in each socket's attachment, with its channels and
  watches, so all of it outlasts the object's sleep, and in storage for a
  member that could return, so it outlasts a restart (below). A watcher is sent
  a channel's members, whole, when it starts to watch and whenever they change.
- **A client that connects again** under the same id and identity replaces its
  earlier socket (closed with `CLOSE_SUPERSEDED`) and stands where that stood,
  under its connection id, until its `hello` says what it wants. No watcher is
  told unless what it holds changes. It keeps only the places its new grant
  lets it enter.

A presence entry ends in one of three ways:

| When | Watchers are told |
| --- | --- |
| The client sends `leave` or `detach`, or the app calls `disconnect` | At once |
| Its socket closes | After the grace period, if its client has not returned. At once if it named no client, since nothing can return |
| Its socket never closes, its pings stop, and it does not answer when asked | When the alarm sweeps it at the limit, closing it with `CLOSE_STALE` |

**The object asks before it sweeps** (ADR-0139). A page's heartbeat is a timer,
and a browser slows a hidden page's timers but not its message handlers. So
when a member has sent no ping for `askMs`, the alarm sends its socket an `ask`
frame, once for that silence. A client answers with a `ping` from the handler
the frame arrived in. The runtime answers that ping as any other, so the answer
does not wake the object: the alarm reads it when it next looks. A member that
answered is kept and no watcher is told; one that did not is swept at
`sweepMs`. The object remembers whom it asked in memory and writes nothing; one
that slept since may ask a second time.

The alarm is set only while a member is present or held, for the first moment
one of them could need asking or telling of: a grace period's end, the ask of a
member not yet asked, or the limit of one that was. While every member pings
every 15 s that is one alarm every 15 to 30 s. A member that only answers has
two alarms of its own every 30 s: its ask, and 15 s later the look that finds it
answered.

**A restart of the object is a closed socket for every member at once**, and
no close reaches the object: the runtime stops it, its sockets end, and their
attachments end with them. So a member whose client named itself is also a row
in the object's storage (`member`), written when its presence changes: an
enter, an update that changes its data, a leave, a `hello` or a replacement
that changes what it holds, a close, a sweep, a `disconnect`. Never for a
publish. When the object starts, a stored member whose client has no socket is
held for the grace period from then, under its connection id, as a closed
socket's is: it is in the members a watcher is sent, its client returning takes
its place back with no watcher told, `disconnect` drops it, and the alarm tells
watchers if it does not return. A member that named no client cannot return and
is not stored: a restart ends it, and the watchers it would have told are gone
with it.

After a sleep the sockets are still there, so nobody is held. Telling the two
apart costs one read of that table each time the object starts, and none on a
publish.

### Timings

A subclass states the timings it changes; nothing reads a variable.

```ts
export class BriefRealtime extends RealtimeObject<Env> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env, { graceMs: 2000 });
	}
}
```

| Option | Default | What |
| --- | --- | --- |
| `retentionMs` | 2 minutes | How long a channel's log answers a reattach |
| `graceMs` | 5 s | How long a member whose socket closed is held |
| `sweepMs` | 45 s | How long a member's pings may have stopped: three of a client's 15 s pings |
| `askMs` | Two thirds of `sweepMs`: 30 s | How long a member's pings may have stopped before it is asked: two of those pings. At `sweepMs` or more, nobody is asked |

### Its tests

`test/object` runs the class in local `workerd` with no credential: Wrangler's
test harness serves `test/object/worker`, a Worker that exports the class at its
defaults and under timings short enough to wait out, and grants whatever a test
asks for. It is never deployed. The tests drive it from Node over `WebSocket`.

The Workers runtime's types are `test/object/worker/worker-configuration.d.ts`,
generated and committed. `pnpm typecheck` fails while it is stale: after
bumping `wrangler` or changing that Worker's `wrangler.jsonc`, run
`pnpm types:object` and commit the result.

## The client transport

`createSocketTransport` holds one socket to one scope's object and keeps it:
it reconnects, catches up from the object's log and heartbeats. Nothing asked
of it is forgotten on failure (ADR-0023, in `apps/stream/docs/adr`): a handler,
a presence watch or a presence entry made while there is no connection is kept
and sent when the socket opens, and only its consumer's disposal ends it.

```ts
import { checkOnPageEvents, createSocketTransport } from '@keepr/realtime/client';

const transport = createSocketTransport({
	// Asked for on every connect, and waited for: a caller admitted by a
	// single-use ticket fetches one here.
	address: async () => `wss://app.example/realtime?ticket=${await ticket()}`,
});
const stopChecking = checkOnPageEvents(transport);

const stop = transport.onMessage('some-channel', 'some-name', (data) => {});
transport.onContinuityLost('some-channel', () => {
	// Messages were missed: read again.
});
```

| Rule | What the transport does |
| --- | --- |
| The address | Asked for on every connect. One that throws, rejects or is slow is a failed attempt like any other. The transport adds its client id (`CLIENT_ID_PARAM`) to the query, the same for its whole life, so the object replaces the socket it lost. |
| Retries | Without limit: the first after 250 ms, doubling to 4 s, then 5, 10 and 20 s, then one every 30 s. The rhythm starts again once the object has answered on a socket; a socket that answered only its ping leaves it where it was. |
| Connect timeout | 10 s from asking for the address to the socket opening (`connectTimeoutMs`). |
| Heartbeat | A `ping` as the socket opens and every 15 s (`heartbeatMs`). A socket that sends nothing in the 5 s after one (`pongTimeoutMs`) is given up, and a late close or frame from it is not heard. |
| An `ask` | Answered with a `ping` at once, from the handler it arrived in, whatever the heartbeat is doing. No timer sends it and it waits for no pong, so a hidden page whose timers are slowed still answers. As a frame heard, the ask ends a wait for a pong like any other. |
| Connected | Once a frame is heard, not once the socket opens: a refused socket opens too. |
| The fault | `connectionState` is `suspended` once there has been no connection for 8 s (`faultAfterMs`), counted from the cut or from the first connect, whatever the count of retries. It clears on connect. `error` says why there is no connection. |
| A refusal | A socket closed with `CLOSE_REFUSED` sets `refusal`, which a dead network never does. So does an `address` that rejects with a `RefusedError`, for a caller refused where its ticket is given; the error it rejected with is the refusal's `cause`. Any other rejection is a failed attempt. Retries go on from the 5 s step, and the refusal clears on connect. |
| A refused channel | A `refused` frame is in `channelRefusals` until the next socket asks again or the consumer ends what it asked. What was asked stays wanted, and is in every `hello`. |
| `CLOSE_STALE` | Reconnects at once. |
| `CLOSE_SUPERSEDED` | A cut like any other, retried from the 5 s step and no refusal. A client id is one transport's alone, so the newer socket is an attempt it gave up that the object accepted late, and it must come back by itself. From the 5 s step, two holders of one id could change places only once a step. |
| Continuity | A reattach the object resumes delivers what was missed once and in order, and tells nobody. One it cannot, a first attach the connection dropped before, and a sequence skipped while attached each tell the channel's `onContinuityLost` listeners once. `onceAttached` tells of a channel's next attach. |
| Presence | An entry also attaches its channel. A watcher is told its channel's members whole; one that comes later is told the members last heard. |
| `checkNow()` | Pings an open socket, or cuts the wait before the next retry. `checkOnPageEvents` calls it on a page's `online` and on its `visibilitychange` to visible, and does nothing where there is no page. |
| Nothing asked of it | The socket closes and `connectionState` is `closed`; the next thing asked connects again. |
| `dispose()` | Ends timers, socket and listeners. |

The source uses no DOM and no Node API. It takes its `WebSocket` and timers
from the options, or from `globalThis` when given none, and `tsconfig.client.json`
checks it with neither the DOM library nor Node's types. Its tests run under
Node on a fake socket and clock (`test/client/helpers/rig.ts`), and once on
Node's own `WebSocket` and timers. No test runs it in a browser.
