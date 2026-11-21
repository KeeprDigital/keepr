# @keepr/realtime

Realtime for every app in the workspace (ADR-0137, in the root `docs/adr`): one
Durable Object per scope an app names, holding every socket of that scope, the
client transport that reconnects to it, and the Nuxt layer an app extends to
have them (ADR-0138). It knows channels, sockets and presence. It names no
product: an app supplies the scope, the channel names and who may hear and
enter what.

| Import | What |
| --- | --- |
| `@keepr/realtime/protocol` | The frames both ends speak, and the close codes |
| `@keepr/realtime/object` | The Durable Object class an app's Worker exports |
| `@keepr/realtime/client` | The client transport, with no framework in it |
| `@keepr/realtime/nuxt` | The Nuxt layer an app that wants realtime extends |

`src/` has no framework in it. Nuxt is a peer dependency that only `nuxt/`
reads.

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
// When one replaces it: the holder's sockets close, but for the new credential's.
await env.REALTIME.getByName(scope).disconnect(holder, { except: credential, version });
// When the scope itself has ended: every socket closes, whatever its grant.
await env.REALTIME.getByName(scope).disconnectAll();
```

**`disconnect` withdraws, it does not only close.** For `withdrawalMs` after it,
the object lets in no socket whose grant carries the tag: accepted, then closed
with `CLOSE_REFUSED`. This is for the socket whose grant the app decided just
before the disconnect and which reaches the object just after, which would
otherwise outlive the credential that admitted it. A grant that also carries
`except` is spared, then and after. So a tag that must be usable again at once
names what was withdrawn, not only who held it. Where credentials are
numbered, `version` says which one `except` is: of two disconnects of one tag,
the one that spares the higher version stands, whichever reaches the object
last, so two regenerations whose disconnects cross never leave the older
credential let in. The withdrawal is in the object's storage, and outlasts its
sleep and its restart.

A socket the object refuses for a withdrawal is never the object's: it answers
with no socket, and `connectSocket`, in the app's Worker, answers the caller
with a socket closed with `CLOSE_REFUSED`. So a peer that never completes the
close holds no object awake.

**`disconnectAll` withdraws everyone**, for a scope the app has ended, as
deleting what it names ends it. It closes every socket with `CLOSE_REFUSED`
and ends every member's grace period, so nobody is left present or held. For
`withdrawalMs` after it, the object lets in no socket at all, whatever its
grant carries. Then the alarm releases what the scope stored: its log, its
heads, its withdrawals and its epoch.

| Export | What |
| --- | --- |
| `RealtimeObject` | The class. `publish(deliveries)` answers each delivery's `seq` on its channel and the `recipients` it was sent to; `disconnect(tag, { except, version })` and `disconnectAll()` answer how many sockets they closed. |
| `connectSocket(stub, request, grant)` | Hands a socket's upgrade to a scope's object with what the app grants it. The only way in. |
| `refuseSocket()` | Answers an upgrade the app refuses: an accepted socket closed with `CLOSE_REFUSED`, which a page can read where it cannot read a 403. |
| `DeliveryError` | What `publish` throws for a delivery it will not publish, before it publishes any. |
| `MAX_MESSAGE_BYTES`, `MAX_CLIENT_FRAME_LENGTH`, `MAX_HELLO_ENTRIES`, `FRAME_BURST`, `FRAMES_PER_SECOND`, the `DEFAULT_*` timings | The limits below. |
| `Grant`, `Delivery`, `DisconnectOptions`, `PublishAnswer`, `RealtimeObjectOptions`, `RealtimeObjectStub` | Their types. |

### The grant

The app decides who the caller is; the object enforces what it was told.

| Field | What |
| --- | --- |
| `identity` | Who the caller is, in the app's terms. A client id replaces only sockets of the same identity. |
| `hear` | The channels it may attach to, and whose presence it may watch. |
| `enter` | The channels it may enter presence on. None when left out. |
| `tags` | Names `disconnect` can close it by, and refuse it by for a while after, fixed when the socket is accepted. At most 9, of 240 characters. |

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
  every call's, are heard in the order published, across channels. A socket
  silent past `sweepMs` is no recipient, and is not counted as one.
- **A publish is all or nothing.** Each delivery names a channel and a name,
  and its data stays within 64 KiB as JSON (`MAX_MESSAGE_BYTES`, ADR-0137).
  Every delivery is checked first: a call with one that is not is refused with a
  `DeliveryError`, and none of its deliveries is numbered, logged or sent.
- **The log is pruned** by a publish, and by the alarm, so a scope that goes
  quiet does not keep its last burst past `retentionMs`.
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
  lets it enter, and none that would not fit in its socket beside that grant.
- **A `hello` may be sent again**: each replaces whatever the socket held, as
  the first did.
- **A deploy keeps a socket only if the object was hibernating.** The runtime
  carries a hibernated object's sockets over to the new code; an object awake
  at the deploy is restarted, which closes them (below).

**What one socket can cost is bounded** (ADR-0159). Each limit closes the
socket with a code of its own, which the client transport reads:

| Limit | What exceeds it | Closed with |
| --- | --- | --- |
| A frame of `MAX_CLIENT_FRAME_LENGTH` characters, 32 Ki: twice what a socket can hold | A longer frame, before it is parsed | `CLOSE_TOO_LARGE` |
| A `hello` of `MAX_HELLO_ENTRIES` entries, 256, attaches, watches and entries together | One of more, before any log is read. A channel a `hello` names more than once is attached, and its log read, once | `CLOSE_TOO_LARGE` |
| `FRAME_BURST` frames, 120, refilled at `FRAMES_PER_SECOND`, 20. A ping is the runtime's, and not counted | A frame past the budget | `CLOSE_RATE_LIMITED` |
| `socketsPerIdentity` sockets of one identity in the scope | A newer socket retires the identity's oldest | `CLOSE_CROWDED` |
| `maxAgeMs`, an hour, from the socket's accept | The alarm closes it, and its client comes back within a second to be judged again by the app's port. Its member is held for the grace period, as a closed socket's is | `CLOSE_EXPIRED` |

A socket that holds more than the runtime's 16 KiB attachment is refused the
attach, watch or entry that would put it past it, and keeps what it held.

A presence entry ends in one of three ways:

| When | Watchers are told |
| --- | --- |
| The client sends `leave` or `detach`, or the app calls `disconnect` | At once |
| Its socket closes | After the grace period, if its client has not returned. At once if it named no client, since nothing can return |
| Its socket never closes, its pings stop, and it does not answer when asked | When the alarm sweeps it at the limit, closing it with `CLOSE_STALE` |

**The object asks before it sweeps** (ADR-0139). A page's heartbeat is a timer,
and a browser slows a hidden page's timers but not its message handlers. So
when a socket has sent no ping for `askMs`, the alarm sends it an `ask` frame,
once for that silence. A client answers with a `ping` from the handler the
frame arrived in. The runtime answers that ping as any other, so the answer
does not wake the object: the alarm reads it when it next looks. A socket that
answered is kept and no watcher is told; one that did not is swept at
`sweepMs`. Every socket is asked and swept so, present or not (ADR-0159): a
peer that vanished costs its socket, and every frame sent it, until it is. The
object remembers whom it asked in memory and writes nothing; one that slept
since may ask a second time.

The alarm is set while any socket is open, anyone is held, the log holds a
message or an ended scope has storage to release, for the first moment one of
them could need doing: a grace period's end, the ask of a socket not yet asked,
the limit of one that was, a socket's age, the oldest message leaving the log,
or the end of `disconnectAll`'s withdrawal. While every socket pings every 15 s
that is one alarm every 15 to 30 s. A socket that only answers has two alarms
of its own every 30 s: its ask, and 15 s later the look that finds it answered.

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

### Timings and limits

A subclass states the options it changes; nothing reads a variable. An app on
the Nuxt layer states `maxAgeMs` as `realtime.maxSocketAgeMs` instead.

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
| `graceMs` | 5 s | How long a member whose socket closed is held. Under 2 s, a client replaced by its own late socket returns after its place is gone, and watchers see it leave |
| `sweepMs` | 45 s | How long a socket's pings may have stopped: three of a client's 15 s pings |
| `askMs` | Two thirds of `sweepMs`: 30 s | How long a socket's pings may have stopped before it is asked: two of those pings. At `sweepMs` or more, nobody is asked |
| `withdrawalMs` | 60 s | How long a `disconnect` or `disconnectAll` goes on refusing the sockets it withdrew: longer than a hand-off takes, from the app's port deciding a grant to the object accepting its socket |
| `maxAgeMs` | An hour | How long a socket is kept before it is closed with `CLOSE_EXPIRED`, so its caller is judged again |
| `socketsPerIdentity` | 32 | How many sockets one identity may hold in the scope |

### Its tests

`test/object` runs the class in local `workerd` with no credential: Wrangler's
test harness serves `test/object/worker`, a Worker that exports the class, and
the class again on a clock a test moves, and grants whatever a test asks for.
It is never deployed. The tests drive it from Node over `WebSocket`.

**No test waits out a timing.** The test class reads the object's clock
(`now()`, and a ping's time through `pingedAt()`) as real time plus what the
test moved it on by, and `advance(ms)` moves it and runs the alarm as the
runtime would. A test of a grace period, a sweep, the log's retention, a
ticket's or a socket's age moves the clock past it at the defaults, so a busy
machine cannot outlast one between two steps.

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
| Retries | Without limit: the first after 250 ms, doubling to 4 s, then 5, 10 and 20 s, then one every 30 s. Each wait is cut by a random part of up to a fifth of it (`random`), so clients cut together do not come back together, and no wait is longer than the rhythm says. The rhythm starts again once the object has answered on a socket, or once a socket has stayed up through a heartbeat, as one that only holds does; a socket that answered only its first ping leaves it where it was. |
| Connect timeout | 10 s from asking for the address to the socket opening (`connectTimeoutMs`). |
| Heartbeat | A `ping` as the socket opens and every 15 s (`heartbeatMs`). A socket that sends nothing in the 5 s after one (`pongTimeoutMs`) is given up, and a late close or frame from it is not heard. |
| An `ask` | Answered with a `ping` at once, from the handler it arrived in, whatever the heartbeat is doing. No timer sends it and it waits for no pong, so a hidden page whose timers are slowed still answers. As a frame heard, the ask ends a wait for a pong like any other. |
| Connected | Once a frame is heard, not once the socket opens: a refused socket opens too. |
| The fault | `connectionState` is `suspended` once there has been no connection for 8 s (`faultAfterMs`), counted from the cut or from the first connect, whatever the count of retries. It clears on connect. `error` says why there is no connection. |
| A refusal | A socket closed with `CLOSE_REFUSED` sets `refusal`, which a dead network never does. So does an `address` that rejects with a `RefusedError`, for a caller refused where its ticket is given; the error it rejected with is the refusal's `cause`. Any other rejection is a failed attempt. Retries go on from the 5 s step, and the refusal clears on connect. |
| A refused channel | A `refused` frame is in `channelRefusals` until the next socket asks again or the consumer ends what it asked. What was asked stays wanted, and is in every `hello`. |
| `CLOSE_STALE` | Reconnects at once: the socket was only slow to ping. |
| `CLOSE_EXPIRED` | Reconnects within a second, at a random moment: the socket is to be judged again, and the sockets accepted with it expired with it. |
| `CLOSE_CROWDED`, `CLOSE_TOO_LARGE`, `CLOSE_RATE_LIMITED` | A cut, retried from the 5 s step, and no refusal: a quick retry would only meet the limit again. |
| `CLOSE_SUPERSEDED` | A cut like any other, retried after 2 s and then from the 5 s step, and no refusal. A client id is one transport's alone, so the newer socket is an attempt it gave up that the object accepted late, and closed since: it must come back by itself, and inside the object's 5 s grace, so the place that socket held for it is still there and no watcher sees it leave. Two holders of one id could change places only once in 2 s. |
| Continuity | A reattach the object resumes delivers what was missed once and in order, and tells nobody. One it cannot, a first attach the connection dropped before, and a sequence skipped while attached each tell the channel's `onContinuityLost` listeners once. A channel asked for, forgotten and asked for again before the object has answered is answered twice in order, and only the last answer speaks for it: it tells of no loss. `onceAttached` tells of a channel's next attach, and then asks nothing more of it: a channel nothing else asks for is forgotten. |
| Presence | An entry also attaches its channel. A watcher is told its channel's members whole; one that comes later is told the members last heard, unless the socket that heard them has since been cut or the watch refused. |
| `checkNow()` | Pings an open socket, or cuts the wait before the next retry. `checkOnPageEvents` calls it on a page's `online` and on its `visibilitychange` to visible, and does nothing where there is no page. |
| `reconnect()` | Cuts the socket in use, or the wait before a retry, and connects at once, asking for the address afresh: for a caller whose credential changed, to be judged again on it. Everything asked is kept, and each channel attaches again as after any cut. Nothing happens when nothing is asked. |
| Nothing asked of it | The socket closes and `connectionState` is `closed`; the next thing asked connects again. |
| `hold()` | Keeps the socket though nothing else is asked, until the function it returns is called: for a caller whose consumers come and go, where each socket costs an address. A hold is a need like any other, which asks the object for nothing: it connects when there is no connection, is retried through a cut, and shows the fault and a refusal as any other does. Each hold is its own, so the socket is kept until every one is released; the last released with nothing asked closes it. A channel is still forgotten with the last thing asked of it, and is a first attach for whoever asks next. |
| `dispose()` | Ends timers, socket, listeners and holds. |

The source uses no DOM and no Node API. It takes its `WebSocket` and timers
from the options, or from `globalThis` when given none, and `tsconfig.client.json`
checks it with neither the DOM library nor Node's types. Its tests run under
Node on a fake socket and clock (`test/client/helpers/rig.ts`), and once on
Node's own `WebSocket` and timers. No test runs it in a browser.

## The Nuxt layer

`nuxt/` is the layer an app that wants realtime extends, beside the layer every
app extends (ADR-0138). An app that does not names neither it nor this package.
It keeps the shared layer's rules (ADR-0093): no route, no middleware, no
product's name, and it typechecks and tests alone.

An app takes it with a dependency on `@keepr/realtime`, the `extends` line, its
own binding and its own port.

```ts
// nuxt.config.ts
export default defineNuxtConfig({
	extends: ['@keepr/nuxt-layer', '@keepr/realtime/nuxt'],
	// Each is this unless the app says otherwise.
	realtime: { binding: 'REALTIME', socketPath: '/realtime/socket', portPath: '/realtime/port' },
});
```

```jsonc
// wrangler.jsonc. Wrangler does not inherit a binding into an `env` block, so
// each Environment restates `durable_objects`; `migrations` is inherited.
"durable_objects": { "bindings": [{ "name": "REALTIME", "class_name": "RealtimeObject" }] },
"migrations": [{ "tag": "v1", "new_sqlite_classes": ["RealtimeObject"] }]
```

```jsonc
// The configuration `nuxt dev` reads (below): the class is in another Worker there.
"durable_objects": {
	"bindings": [
		{ "name": "REALTIME", "class_name": "RealtimeObject", "script_name": "keepr-realtime-dev" }
	]
}
```

```ts
// server/routes/realtime/port.ts: the app's own route, at `realtime.portPath`
export default defineRealtimePort(async (event) => {
	const user = await whoIsThis(event); // the app's own rule
	if (!user) return null;
	return { scope: `room:${room}`, grant: { identity: user.id, hear: [`room:${room}:*`] } };
});

// Anywhere the server writes:
await useRealtimeScope(event, `room:${room}`).publish([{ channel, name, data }]);
```

| `realtime` | Default | What |
| --- | --- | --- |
| `binding` | `REALTIME` | The Durable Object binding the app's Wrangler configuration gives `RealtimeObject`. |
| `socketPath` | `/realtime/socket` | Where a page opens its socket: one path under `nuxt dev` and in the built Worker. |
| `portPath` | `/realtime/port` | Where the app's route answers the port. Not `socketPath` itself. |
| `maxSocketAgeMs` | An hour | How long the object keeps a socket before it closes it, to have its caller judged again by the port (`maxAgeMs`). |

| Piece | What |
| --- | --- |
| The Worker entry (`nuxt/server/worker/entry.ts`) | A production build's entry, wrapping Nitro's. It exports `RealtimeObject`, at the app's `maxSocketAgeMs`, and hands an upgrade on `socketPath` to a scope's object. Every other request is Nitro's. Only a build takes it: under `nuxt dev` it would replace Nitro's dev entry. |
| `defineRealtimePort(port)` | The route that answers the app's port: given the event, a scope and a grant, or `null` to refuse. The layer registers no route, so the app exports this from a file of its own. |
| `useRealtimeScope(event, scope)` | One scope's object on the app's own binding: `publish(deliveries)`, `disconnect(tag, { except, version })` and `disconnectAll()`, by RPC. Takes the Worker's bindings where there is no request, as in a scheduled handler. |
| The dev Worker (`nuxt/server/worker/dev.ts`) | Holds the class beside `nuxt dev` (below). |

`defineRealtimePort` and `useRealtimeScope` are auto-imported from
`nuxt/server/utils/realtime.ts`; code that names them imports
`@keepr/realtime/nuxt/server/utils/realtime`.

### The hand-off

An upgrade on `socketPath` is put to the app's port before any object sees it.
The port is asked with a plain `GET` of `portPath` that carries the socket's
query, the caller's headers and its Cloudflare properties (`cf`), so the app
reads a cookie, an `Origin`, a ticket or the caller's country as it does
anywhere, and its own middleware runs first. Nothing of the upgrade goes with
it.

| The port answers | The caller gets |
| --- | --- |
| A scope and a grant | Its socket, handed to that scope's object with that grant (`connectSocket`) |
| `null` | A socket closed with `CLOSE_REFUSED` (`refuseSocket`), which a page can read |
| Nothing, and 401 or 403: a middleware refused the caller first, or the port threw one | A socket closed with `CLOSE_REFUSED`, as for `null` |
| Nothing otherwise: a middleware answered first, the port failed, or no route is there | The app's own response, which a page reads as a failed attempt and retries. An answer of the app's that is no error and no port's is a 500 that says so |

A request for `socketPath` that is no upgrade is answered 426, and one the
Worker has no `binding` for is a 500 that names it.

**The port's route is no way in, and no way to ask.** Only the hand-off reaches
it; any other request is answered 404.

- **In the built Worker** the entry marks the request object it makes, in
  memory, and the route asks whether it was handed that object. It reads no
  header and no query for this, so nothing a caller sends can stand for it.
- **Under `nuxt dev`** the request comes over the loopback from the dev
  server's own process, with a secret made for that run. The dev Worker never
  holds the secret, and a build has no such branch.
- **A caller cannot supply what the hand-off reads.** `x-realtime-ticket` and
  `x-realtime-hand-off` are taken off its request before the port is asked,
  and `connectSocket` sets the ticket itself.

### Under `nuxt dev`

`nuxt dev` runs the server in Node, which cannot hold a Durable Object. So the
layer starts a Worker beside it in local `workerd`, which holds the class, and
Nitro's dev proxy (`ws: true`) sends `socketPath` there. A page opens the same
path it opens on the built Worker. The proxy takes every path that starts with
its route, so its route is one of the layer's own, and the dev server sends a
request for `socketPath` itself, and nothing else, there before anything else
hears it (`nuxt/build/paths.ts`): an app's route that only starts like the
socket's path stays the app's, as it does in the built Worker. The dev Worker asks the app's port through
the dev server and hands off as the entry does.

**The dev server itself starts it**, from the layer's module. So an app's
`pnpm dev` starts it, and so does anything else that runs `nuxt dev`, an
integration suite's servers among them.

**It stops with the dev server, in the dev server's own shutdown.** Miniflare,
which runs the dev Worker, listens for `SIGINT` and `SIGTERM` in the process it
is started in, and ends that process at once. Left there, it cuts Nuxt's
shutdown off before anything is closed, and the `workerd` of Nitro's bindings
is left running with no parent. So the layer takes those listeners off again
once the dev Worker has started, each time it starts. A signal to `nuxt dev`
alone then closes the dev Worker and Nitro's `workerd` with it.

**The dev binding lives in the configuration `nuxt dev` reads**
(`nitro.cloudflare.dev.configPath`), a dev configuration apart from the
deployed one, as `wrangler.dev.jsonc` is in Stream Keepr. It names the dev
Worker by `script_name`, so the server publishes by RPC on a real binding, with
the code it runs when built. It is not a Wrangler environment of
`wrangler.jsonc`: that file is what is deployed, each `env` block in it is an
Environment held to production's bindings, and a `dev` block there is one
mistyped `--env` from a deploy.

**Two dev servers at once share nothing.** The dev Worker listens on a free
port of its own choosing. A `script_name` binding finds its Worker through
Wrangler's local registry, which is one directory for the whole machine, keyed
by the Worker's name; so each dev server keeps a registry of its own, under
the app's `.wrangler`, by setting `WRANGLER_REGISTRY_PATH` for its process.
One already set is left alone. An app that binds another local Worker through
the registry, as the Accounts Stand-in is bound, starts both under one
`WRANGLER_REGISTRY_PATH`, one for each dev server: `keepr-accounts-stand-in --
<command>` names one for each run (`packages/accounts-stand-in/README.md`).

**The dev Worker keeps nothing between runs.** Each run starts from empty
storage, so a page that held a sequence is told continuity was lost, by the
object's epoch, and reads again.

**Hot reload leaves it alone.** A change to the app's code reloads the page or
the server as before; the dev Worker and its sockets are untouched. A change
to `nuxt.config.ts` restarts Nuxt and the dev Worker with it, and each socket
reconnects.

### Its tests

`nuxt/test/fixture` is an app as the tests need one: it takes the layer by the
`extends` line, and its port lets a caller with a cookie into the room its query
names. It is never deployed. `nuxt/test/handOff.test.ts` builds it, then holds
each rule above twice: on the built Worker in local `workerd`, and under
`nuxt dev`, on one path, driven from Node by the client transport, the
server's `disconnect` and `disconnectAll` over each binding among them. The
port's question and the reading of its answer are held alone in
`nuxt/test/portRequest.test.ts`, and the dev proxy's path in
`nuxt/test/paths.test.ts`. `handOff.test.ts` then
runs two dev servers at once, and holds that neither hears the other's
publishes. Last it stops a dev server by `SIGTERM` and by `SIGINT` to its
process alone, and holds that nothing it started is left running. That server
runs as a developer's does: told that a suite or CI started it, Nitro ends its
own worker without waiting, and strands its `workerd` whatever the layer does.

`pnpm typecheck` checks the layer as an app with nothing but itself
(`nuxt prepare`), in three programs: its configuration and module, what a
Worker runs, and the tests with their fixture.
