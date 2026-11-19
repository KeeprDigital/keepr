# Can Stream Keepr's realtime move off Ably onto Cloudflare?

Research note for #1295 · 2026-11-18 · no production change

This note is evidence for a decision, like a spec in flight (ADR-0095): once
#1295 is settled, what it decides becomes decisions and rules, and this file is
deleted.

**Constraint, set by the owner on 2026-11-18:** if this path is taken, what is
built must serve every app in the workspace that needs realtime, not Stream
Keepr alone. [Section 6](#6-built-for-every-app) says what that changes.

## Recommendation

**Move, all of it, in stages behind the two ports that already exist. Nothing
forces a date.** The Staging run this waited on held.

- **It can.** Everything Stream Keepr uses Ably for fits one Durable Object per
  Event with hibernating WebSockets. A throwaway prototype carried the rig #189
  measured (3 Screen Outputs, 2 operator pages) with fan-out, reconnect
  catch-up and presence, every count asserted, under local `workerd` and then
  deployed in the Staging account.
- **Money barely decides it.** Both are free at today's load. At 10× Durable
  Objects cost at most $0.15 a month, and Ably's Free package is 1.1× to 1.6×
  from its monthly allowance, with $29 to $35 a month as the next step.
- **What decides it** is what Ably costs besides money: a key and an Ably app
  per Environment, realtime tests CI cannot run, and a Free package whose limits
  end a show rather than raise a bill. Against that, a move makes Stream Keepr
  the owner of reconnection, heartbeat and presence, which Ably's SDK does now.
  A 375-line client prototype kept ADR-0023's rules through cut connections, a
  silent network and an outage longer than the log, locally.
- **Build it once, for every app.** The transport knows channels, sockets and
  presence, never an Event or a Screen; each app supplies who may hear what.
- **Not "move part".** Keeping one channel kind on Ably keeps the key, the SDK
  and the quota, and adds a second transport to reason about.
- **Not yet shown:** a venue's network, a client far from the object, OBS, and
  a machine that vanishes (see [What is not measured](#what-is-not-measured)).
  The Staging run was one machine near one Cloudflare location. Two results
  could still change this recommendation: delivery latency with the object far
  from its clients, and how long a vanished Screen Output stays in presence.

How each statement below is known: **READ** in this repository at `a92811ac`,
**MEASURED** by the prototype, locally or on Staging as stated, **DOCS** fetched
2026-11-18, **CARRIED**
from #189's measurement, or **NOT MEASURED**.

## 1. What Stream Keepr uses Ably for

### Channels (READ: `shared/utils/realtimeChannels.ts`)

| Channel | Carries | Who subscribes |
| --- | --- | --- |
| `event:<eventId>` | Every Event message, of the 63 types in `shared/types/messages.ts` | Operator pages and previews (the Realtime Event Session) |
| `screen:<eventId>:<screenId>` | The Screen's own messages forwarded unchanged (Card, Broadcast Graphics Live Session, Feature Match Session), `output:*` notices, `screen:command:*` | That Screen's Screen Outputs and Program Monitors, which hear no other channel (ADR-0022); control surfaces for presence |

### Per capability

| Capability | Use | Where |
| --- | --- | --- |
| Publish | Server only, over REST. 24 call sites in 7 files, all through three functions: `publishMessage` (logs and swallows), `publishMessageStrict` (throws), `publishScreenCommand` (throws `RealtimePublishError`). Screen channels go out as one `batchPublish` of up to 100 channels. No client publishes. | `server/utils/ably.ts` |
| Subscribe | By message name, on the Event channel ("room") and on named channels | `app/plugins/realtime.client.ts` |
| Presence | Only a Screen Output enters, on its Screen's channel, with `ScreenPresenceData`; it updates that data in place. Control surfaces watch and count members. Nothing reads `clientId`. | `useScreenRealtimeSession.ts`, `app/modules/screen/runtime.ts` |
| History | **Granted to a Session and never called.** No `history()`, no rewind, no `untilAttach` anywhere. | `server/api/realtime/token.get.ts` |
| Token auth | `GET /api/realtime/token` signs a token request for one Event. A Session gets the Event channel and `screen:<eventId>:*`; a Screen Output Asset Capability gets the Event channel and its one Screen's, for 10 minutes, so a regenerated capability stops hearing within that. An output following its Screen's channel (presence `protocol: 2`) no longer hears the Event channel it is granted. `clientId` is pinned: the user id, or `screen-output:<screenId>`. | ADR-0010 |
| Ordering | Ably's, per channel. Nothing orders an Event message against the Screen notice it caused. Sequenced state (the Live Session) carries its own sequence and reloads when behind. | ADR-0004 |
| Size | 64 KiB per message, the Free package's ceiling. An oversized publish is logged, not refused. Design rule since #95: a message announces, a read is authority. | `MAX_REALTIME_MESSAGE_BYTES` |
| Recovery | Ably resumes a connection within 2 minutes and replays what it missed. The transport reads the channel's `resumed` flag: not resumed means continuity was lost, and the consumer re-reads (Reconnect Resync). A first attach on an unbroken connection is not a loss; a consumer that read before it re-reads off a second signal, `onceAttached`. The notices on a Screen's channel carry no sequence number, so this is their only recovery. | ADR-0023 |
| Echo | A write sends `x-realtime-connection-id`; the message carries it back as `originConnectionId`; the client drops its own. Filtered after delivery, so it is still billed. | `useRealtimeMessageGate.ts` |

### The seams that exist

- **Client:** `RealtimeTransport` (`app/types/realtime.ts`) is a port with one
  implementation, the 914-line plugin. Its consumers, a dozen files, import only
  the port.
  About half the plugin exists because an Ably token covers one Event at a time
  (`coveredEventId`, `recoverEvent`, pending subscriptions).
- **Server:** `server/utils/ably.ts` is the only server file that imports the
  SDK; the token route reaches it through `getAblyClient`.
  `PublishToScreenChannels` is already a port. `scripts/measure-realtime-fanout.mjs`
  imports the SDK too.
- **Tests:** 19 test files mock the `ably` module, 15 through
  `test/helpers/ablyRestFake.ts`. Nine `*.realtime.test.ts` integration files
  need a real key, so CI skips them.
- **Ably's shape leaks in three places:** the `connectionState` union, the
  connection-id regex in `getOriginConnectionId`, and `publishFailureFields`
  (Ably's `ErrorInfo`).

## 2. What Durable Objects give, what we would build, what we cannot match

The shape tested: one SQLite-backed object per Event, named `event:<eventId>`,
holding every socket of that Event. A socket was tagged with the channels it
hears for the first runs and holds them in its attachment since the client
prototype (section 3); the server publishes by RPC.

| Need | Durable Objects | Verdict |
| --- | --- | --- |
| Fan-out to an Event's clients | `getWebSockets(tag)` and `send`. 32,768 sockets per object; a soft 1,000 requests/s per object, against a measured need of 5 to 60. (DOCS) | Free |
| Idle connections cost nothing | Hibernation: sockets stay open while the object is out of memory; no duration is billed. (DOCS) | Free |
| Ordering | One single-threaded object orders every message of an Event, across its Event and Screen channels. | Free, and stronger than today |
| Message size | 32 MiB per WebSocket message. (DOCS) | Free; the 64 KiB rule becomes a choice |
| A deploy leaves shows connected | Since 2026-10-30 a code update is deferred until the object hibernates, and hibernating sockets stay connected across it. A runtime restart still closes them. (DOCS) | Free for deploys; reconnect must be solid for the rest |
| Publish from the server | An RPC on a binding in the same account, where today it is an HTTPS call to another company. No key, no secret per Environment. | Free |
| Realtime tests in CI | The object runs in local `workerd` with no credential. | Free; ends the exception in the root `AGENTS.md` |
| Auth and capabilities | None built in. Authenticate the upgrade request with the Session or capability, and tag the socket with what it may hear. Revocation becomes closing the Screen's sockets at once, instead of waiting out a 10-minute token. | Build; small. One open decision below |
| Catch-up after a reconnect | A per-channel sequence, a log in the object's SQLite, and `resumed` on attach, which is `onContinuityLost`; the attach frame itself is `onceAttached`. | Build; prototyped |
| Presence | Each socket's attachment holds its presence data (16 KiB limit; `ScreenPresenceData` is a few fields) and survives hibernation (DOCS; the local run does not show the object hibernating). `webSocketClose` is the leave. | Build; prototyped |
| Reconnection, backoff, heartbeat | Nothing. `setWebSocketAutoResponse` answers a client's `ping` without waking the object, so the heartbeat is free, but the client loop is ours. | Build; prototyped locally (section 3). Still the largest piece, and where ADR-0023's fixes must be kept |
| A vanished client leaves presence | Ably drops a member about 15 s after its connection dies. Here it leaves when Cloudflare reports the socket closed, which for a machine that lost power is NOT MEASURED. The object can read when each socket last pinged without waking for the pings, so an alarm can sweep the silent. | Build the sweep; prototyped locally (section 3) |
| History | Not used. | Nothing to do |
| Global edge fan-out | An object lives in one place, near its first request, and does not move. Clients connect at their nearest Cloudflare edge and are carried to it. (DOCS) | **Cannot match.** Fits an Event at one venue; a remote operator pays the distance. NOT MEASURED |
| Fallback when WebSockets are blocked | Ably's SDK falls back to HTTP polling. | **Cannot match** without building it. The slow re-read while realtime is degraded (RULES, Screen Mode Data Freshness) is the fallback that already exists |
| Multi-region failover, a vendor's dashboard | One object, one location; Workers observability instead of Ably's channel inspector. | **Cannot match** |

## 3. The prototype

Branch `spike/1295-realtime-do-prototype`, commits `4b8c8972` and `6d633b36` (a
local branch until someone pushes it),
`apps/stream/prototypes/realtime-do/`: a 246-line Worker and a probe. Not
merged; not bound to the app. These runs are the server half only: the probe
reconnects by hand with the sequence it held. The client's reconnection,
backoff and heartbeat came after, in commit `5f112157`
([the client half](#the-client-half)).

MEASURED under local `workerd` (wrangler 4.161.0), 200 Takes, each published to
the Event channel and one Screen's channel, 1.3 KB payloads as ADR-0004's
realistic Set Input:

| What | Result |
| --- | --- |
| Fan-out | Event channel 5 of 5 on every publish, Screen channel 1 of 1; 400 published, 1,200 delivered, no gap or reorder on any socket |
| Publish, HTTP round trip | p50 2.8 ms, p95 5.0, max 8.1 (the RPC inside it: 1 to 2 ms) |
| Delivery, publish to receipt | Event channel p50 1.6 ms, p95 3.2, max 5.4; Screen channel p50 1.7, p95 3.4, max 5.8 |
| Catch-up | An output dropped across 50 messages reconnected `resumed`, was replayed exactly 50 in order in 4.3 ms, then received live with no duplicate |
| Continuity lost | A sequence from another epoch, and a gap older than the log, both attach `resumed: false`; the gap is asserted to replay nothing. The log's retention was set to 3 s for this, not its 2-minute default |
| Presence | 3 outputs entered and counted; a closed output left the count in 0.7 ms |
| After 20 s idle | Publish reached all 4 remaining sockets (10.5 ms); presence intact for a watcher that connected afterwards. Whether the object hibernated in that time was not observed |

**These are loopback figures.** They show the semantics hold and the object adds
about a millisecond. They say nothing about a network, a venue, or OBS. The
run's output is in the [appendix](#appendix-the-local-run).

### On Staging

MEASURED 2026-11-18, after Stream Keepr 3.0.0 shipped: the same Worker deployed
by hand as `stream-realtime-prototype` on `workers.dev` in the Staging account,
its config naming that account (ADR-0130), then deleted. The probe ran twice
from one development machine that Cloudflare served from Melbourne; where the
object ran was not observed. Each run used a new Event, so a new object. Every
count was asserted as it was locally.

| What | First run | Second run |
| --- | --- | --- |
| Fan-out | 400 published, 1,200 delivered, no gap or reorder | the same |
| Connect, 5 sockets to a new object | 2.6 s, the first requests after the deploy | 0.49 s |
| Publish, HTTP round trip | p50 52 ms, p95 72, max 109 (the RPC inside it: p50 33) | p50 46 ms, p95 65, max 492 (RPC p50 26) |
| Delivery, publish to receipt | Event channel p50 51 ms, p95 69, p99 80, max 108; Screen channel the same within 2 ms | p50 45 ms, p95 63, p99 370, max 494 |
| Catch-up | 50 missed, exactly 50 replayed in order, 101 ms | 50 of 50, 99 ms |
| Continuity lost | A sequence from another epoch attaches `resumed: false`. The gap older than the log was not run here | the same |
| Presence | 3 entered; a closed output left the count in 25 ms | 15 ms |
| After idle | 90 s: the next publish took 124 ms and reached every socket; presence intact | 1 s: 45 ms |

Delivery is one publish going up to Cloudflare and back down to sockets on the
same machine: about 50 ms, against about 2 ms on loopback, so nearly all of it is
the network. The second run had one stall of about 0.4 s across a few
consecutive publishes; its cause was not found. The 124 ms publish after 90 s
idle is what a woken object would cost, but hibernation itself was not observed.
The billed requests and duration were not read before the Worker was deleted.
Both runs are in the [appendix](#appendix-the-staging-runs).

### The client half

Commit `5f112157` on the same branch adds `client.ts`, 375 lines with no
framework in them: what Ably's SDK does for `app/plugins/realtime.client.ts`
(914 lines) today, over one socket to one object. It is not that plugin's
replacement: Stream Keepr's rooms, typed messages and echo filter would be an
adapter over it, not written. The Worker grew to 404 lines for it:

- **A socket's channels are in its attachment, not its tags**, because tags are
  fixed at accept and a page attaches and detaches as it goes. A publish reads
  every socket's attachment.
- **A client names itself across its sockets**, so a reconnect replaces the
  socket it lost and inherits its presence.
- **An alarm sweeps members whose pings stopped**, while anyone is present. The
  object reads each socket's last ping without having woken for it.
- **A refusal is an accepted socket closed with a code.** A browser cannot read
  a refused upgrade's status, so a `401` looks like a dead network.

MEASURED under local `workerd`, twice, by `client-probe.mjs`: one Screen Output's
transport behind a TCP hop the probe can cut or silence, an operator page's
straight to the Worker, every count asserted. The heartbeat was 1 s with 1 s to
wait for the pong, and the log 10 s, to keep a run to a minute; the client's
defaults of 15 s and 5 s were not run.

| What was done to it | Result |
| --- | --- |
| Connection cut 5 times while 200 Takes were published | All 200 heard once and in order on both channels, every reattach `resumed`, no continuity loss told. Back in 255 to 264 ms, which is the first retry's 250 ms wait. The operator page saw the output leave presence at each cut |
| Network silent for 2.1 s: nothing closes | Noticed by the heartbeat in 1.3 and 1.6 s. The 20 Takes published meanwhile were caught up 0.5 s after the network returned, none lost or repeated. The operator page saw no presence change: the new socket stood where the old one was |
| A machine vanishes: its socket never closes | Swept from presence 5.9 s later, with the limit at 6 s |
| Outage of 10.5 s, longer than the log | Each channel told of its loss exactly once and nothing replayed. A channel first asked for while down attached as a loss and told its first attach. A presence update made while down is what watchers saw after. Reattached 4.0 s after the network returned, on the next retry |
| Refused, then the credential corrected | The refusal is readable on the transport while it keeps retrying at the slow rhythm; attached 5.0 s after the credential changed, and heard the next Take |
| The operator page, never disturbed | Heard all 278 in order |

What it showed that the note did not know:

- **A cut the object sees is a real leave.** Ably holds a member about 15 s
  after its connection drops; here watchers are told at once, and again 0.26 s
  later when it returns. Decision 7.
- **A silent network needs a connect timeout as well as a heartbeat**, and the
  timeout stretches the quick retries: five of them take 7.75 s plus up to five
  timeouts, so in the 10.5 s outage the transport never reached `suspended`.
  Decision 6.
- **Recovery waits on the retry rhythm**, up to 30 s at its ceiling. A page's
  `online` event should cut that wait; not built.

The original probe passes against the reworked Worker locally, with delivery at
p50 1.7 ms as before. The Staging figures above are the tagged Worker's.

### The Nuxt Worker and the object

A second throwaway, branch `spike/1295-nitro-durable-object`, commit `4db98465`
(local until pushed): Score Keepr's Worker, built by Nitro 2.13.6 on the shared
layer's preset, exporting the prototype's class. MEASURED under local `workerd`
and under `nuxt dev`:

| Question | Result |
| --- | --- |
| Can a Nuxt Worker export the class? | Not with Nitro's own entry, which exports only `default`. Yes with a custom `nitro.entry` that wraps it and adds the export: the build emits the class and merges the binding and migration into the generated Wrangler config |
| Can an ordinary route hand back the object's `101`? | **No.** Nitro rebuilds every route's response: `RangeError: Responses may only be constructed with status codes in the range 200 to 599` |
| Can the custom entry hand the upgrade over, with the app deciding who may? | Yes. It asks an ordinary route who the caller is through Nitro's own handler, then passes the upgrade to the object: `401` without the stand-in credential, `101` with it, and the attach frame arrives |
| Can a route publish by RPC on the Worker's own binding? | Yes; the socket heard it |
| `nuxt dev`, with the custom entry set | The dev server never comes up: the entry replaces Nitro's dev entry. It must be set for production builds only |
| `nuxt dev`, class in the app's own Worker | Does not work. Wrangler says so at startup, and a call to the object hangs |
| `nuxt dev`, class in a Worker running beside it, bound by `script_name` | A route's RPC publish works. An ordinary route still cannot hand back the `101`, and `nuxt dev` runs no Worker entry |
| `nuxt dev`, the socket through Nitro's `devProxy` with `ws: true` to that Worker | **Works** (commit `9f1e9574`). The Worker beside asks the dev server's authorize route who the caller is, the cookie forwarded: `401` without the stand-in credential, `101` with it, and a route's publish reaches the socket. The page uses the same path as against the built Worker |

So the built Worker can hold the object, and `nuxt dev` cannot: it needs a
Worker running beside it for the object, which Nitro's dev proxy reaches on the
path production uses. What differs in development is who hands the socket over
(that Worker, not the custom entry) and the binding (`script_name`, in a Wrangler
environment `nitro.cloudflare.dev.environment` names). The authorize route, the
class, the publish and the client's URL are the same code in both.
The same entry then went onto Stream Keepr's own build (commit `8e7dc15f` on
that branch), whose Nitro configuration has more in it (Wasm, async context, two
crons). MEASURED: `pnpm build` passes and the built entry exports the class
beside `default`; `pnpm worker:dry-run` passes with all three of its scans and
lists the object among the bindings, the Staging environment's included; under
local `workerd` the upgrade is refused without the stand-in credential and
handed over with it, a route's RPC publish reaches the socket, the hourly cron
still reaches its handler, and an ordinary route still answers. Not run: the
unit, Nuxt and integration suites against that build.

## 4. Cost

Load is #189's "ADR realistic show": 4,000 playouts a month at 19 commands each,
76,000 commands. 10× is 760,000.

| | Today | 10× | Where it stops being free |
| --- | --- | --- | --- |
| **Ably Free** | $0. 380,000 to 532,000 messages of 6,000,000 (×5 to ×7, below) | $0. 3.8M to 5.3M of 6,000,000: 1.1× to 1.6× headroom, and #189 called its figures a floor | Past 6M in a month it is throttled to 1,600 messages an hour until the month ends. 250,000 an hour is already 1.16× from a large rig operated hard (CARRIED). Then Pro: $29 a month billed yearly, $35 monthly (DOCS) |
| **Durable Objects** | $0. About 152,000 requests of 1,000,000 included | $0 to $0.15. About 1.52M requests, $0.15 per million over | Never a cliff: each dimension bills its overage |

- **Ably now bills paid packages per monthly active user**, a unique `clientId`,
  not per message (DOCS). For Stream Keepr that is each operator and each Screen
  that connected that month. Free allows 500. Its page says Free is "intended for
  developers to try out Ably". The limits page reads 500 connections and 500
  channels where #189 recorded 200 and 200: the terms the repository records
  have moved since August.
- **Durable Objects arithmetic** (DOCS for rates): a command is two RPCs as the
  code stands (the Event publish, then its Screens). Outgoing WebSocket messages
  are not billed; incoming ones bill at 20 to 1 and only presence sends any.
  Duration at a generous 10 ms per RPC is under 2,000 GB-s of 400,000 included.
  The log writes about 3 rows per delivery: 4.6M of 50M included at 10×. The
  Workers Paid plan is already paid for: the silent-video validator's container
  needs it.
- **Ably's fan-out is READ, not re-measured.** #189 measured ×6 on the Event
  channel when every output heard it. An output now hears only its Screen's
  channel, so on the same rig a command is 1 publish and 2 operator-page deliveries
  on the Event channel, plus 1 publish and 1 output delivery on the Screen's:
  ×5. It is ×7 if each operator page watching that Screen's presence is also delivered
  its messages, which attaching a channel implies. Measuring again spends the
  quota in question.

## 5. Migration shape

**Both can run side by side behind the ports.**

1. **Server publishes to both.** The three publish functions and
   `PublishToScreenChannels` gain a second destination. A write already finishes
   its Screen notices after it answers.
2. **The client picks one transport at page load** from public runtime config: a
   second implementation of `RealtimeTransport`. No consumer changes. It is
   simpler than the first: one socket per Event with the credential on the
   upgrade, so no token coverage, no mint retries, no pending-until-covered.
3. **Flip per Installation; Staging first.** Rollback is the flag and a reload.
4. **Stop publishing to Ably**, then remove the SDK, the token route and
   `NUXT_ABLY_API_KEY`.

**Screens on air.** A loaded Screen Output keeps the transport it loaded with
until it reloads, and holds its last accepted rendering meanwhile, so nothing
changes under a show by itself. While the server publishes to both, an output on
either hears everything. Moving one is `screen:command:refresh`, sent on the
transport it is on, Screen by Screen, between segments. Its presence entry
already reports the realtime protocol it follows (RULES), which is where a
control surface would say "still on Ably". Presence is the one thing dual
publishing does not cover: a control surface must watch both transports during
the window, or outputs and control surfaces move together.

**Tests.** The Ably fake gives way to a fake at the publish port, a mechanical
change across 19 files. The nine realtime integration files stop needing a key.

## 6. Built for every app

**Who needs it.** Stream Keepr today. Score Keepr's spec (READ:
`apps/score/docs/tournament-spec.md`) has the Consumer "move Actions between
Devices and the server", for "any number of Devices, online or offline", and
warn "when someone pairs while out of contact with the others". Keepr Accounts
states no need.

**The same shape fits Score Keepr.** Its Log is the authority and tolerates any
order and any duplicate, as Stream Keepr's reads are the authority here. So
realtime stays what it is in Stream Keepr: the server publishes after a write,
a message announces, and a Device that lost continuity syncs from the Log. A
Device offline for hours is that sync's to serve, not the transport's log.
"Out of contact with the others" is presence. Nothing in the spec needs a
client to publish, history, or a larger message.

**What in the prototype knows Stream Keepr:** only the object's name,
`event:<eventId>`, and the route that derives it. The object treats a channel
as an opaque string. A shared build keeps it so.

**Where each piece lives**, by the workspace's own rules:

| Piece | Home | Rule |
| --- | --- | --- |
| The Durable Object class and the wire protocol | A package, `@keepr/realtime`, consumed as source by the Worker that exports it | `packages/` holds what more than one app uses |
| The client transport, the `RealtimeTransport` port, Reconnect Resync, the echo gate, the server's publish port | `packages/nuxt-layer` | "Something two apps need moves here, in the change that moves the first app onto it" |
| The upgrade route, the scope that names an object, channel names, who may hear what | Each app | "No route and no middleware"; "Nothing here knows a product" |
| Realtime Subscription, Reconnect Resync and the terms that move with them | Root `GLOSSARY.md`, under Platform | "A shared term is defined once, at the root" |

**What the app supplies** is one port: given a request, answer the identity, the
scope, and the channels it may hear and enter. Stream Keepr answers from a
Session or a Screen Output Asset Capability; Score Keepr would answer from a
Session (ADR-0112) and whatever identifies a Device. The transport enforces the
answer and knows neither.

**It changes the build order.** Stream Keepr's new transport is written in the
shared homes from its first line, with Stream Keepr as the first app on it,
not written in `apps/stream` and moved later. Section 5's stages stand.

**Shared allowances.** An Environment is one Cloudflare account for every app
(ADR-0122), so section 4's included requests and duration are shared between
the apps. Stream Keepr at 10× alone uses about 1.5M requests against the 1M
included.

## 7. Decisions a move would need

1. **One namespace per app, or one realtime service for all.** Shared code
   either way.
   - **Per app (recommended):** each app exports the class and owns its
     objects, as each app owns its database. No deploy order between apps, no
     shared failure, and who may hear a channel stays the app's own rule. There
     is no realtime service: shared source, and each app's own binding, upgrade
     route and channel names.
   - **One service:** a deployable of its own that every app binds, with a
     deploy order as Keepr Accounts has (ADR-0120), and one place for an app to
     hear another's channel. It must ask each app who may hear what, or trust
     tokens the apps mint.
   - **What would flip it:** a plan for Stream Keepr to show Score Keepr's
     tournament live (`GLOSSARY-MAP.md`: "neither reads the other today"). Try a
     service binding into Score Keepr's namespace first. Moving from per app to
     one service later is a hosting change, since the class and protocol are
     shared source either way.
   - **Within per app, the app's own Worker or a Part** (ADR-0119). The app's
     own Worker is proven for the built Worker (section 3): one deployable, no
     deploy order, the caller authorized in process, and a deferred code update
     keeps sockets connected across the app's deploys. It costs a custom Worker
     entry, and `nuxt dev` needs a Worker beside it, reached through Nitro's dev
     proxy (section 3), so only the hand-off and the binding differ in
     development. A Part that owns the socket route is the same shape
     everywhere, at the cost of a second deployable per app and a call back to
     the app to ask who the caller is: shown over HTTP beside `nuxt dev`, not
     over a service binding between deployed Workers. Preferred: the app's own
     Worker.
2. **How development runs the object.** Shown to work (section 3): a Worker
   beside `nuxt dev` holds the class, and Nitro's dev proxy forwards the socket
   to it. Left to decide:
   - **Who starts it.** `pnpm dev` becomes two processes, in every app with
     realtime; the shared layer should own that Worker and its start.
   - **Where the dev binding lives.** A Wrangler environment restates every
     binding the app has, since environments inherit none; a separate dev
     config (`nitro.cloudflare.dev.configPath`) is the alternative. Only the
     environment was tried, on an app with no other binding.
   - The integration suites and the preview run the built Worker, so they take
     production's path.
3. **How a Screen Output presents its capability.** A browser cannot set
   `Authorization` on a WebSocket. A subprotocol value, or a short-lived ticket
   from an HTTP route. Amends ADR-0010's token grant, and the rule that only a
   Session's grant reads channel history goes with it. Build on #1293, which
   makes the Graphics Administrator an App role on a signed-in User: connection
   auth should follow how admin auth works after it, not before. A refusal
   has to be an accepted socket closed with a code, as prototyped: the page
   cannot read a refused upgrade's status.
4. **What names an object.** The app's scope: an Event for Stream Keepr, as
   prototyped, presumably a Tournament for Score Keepr. One object per scope
   gives order across its channels and one RPC per write; one per channel gives
   neither. The client prototype keeps a socket's channels in its attachment
   (16 KiB), which a publish reads for every socket of the scope: fine for
   dozens, not shown for thousands.
5. **Keep the catch-up log, and for how long.** The application already survives
   a missed message by re-reading; the log saves the re-read after a blip or a
   runtime restart. The prototype defaults to Ably's 2 minutes. Amends ADR-0023.
6. **Client reconnection and heartbeat.** ADR-0023's rules carried over in the
   prototype as they are: held until disposed, no attempt limit, 30 s ceiling.
   Left to decide:
   - the heartbeat and its pong wait (15 s and 5 s proposed), which bound how
     long a silent network goes unnoticed;
   - the connect timeout, and whether the fault shows after a count of retries
     or after a time;
   - whether the first retry waits 250 ms or goes at once;
   - with no token to wait on, the token-wait clauses of ADR-0028 and of
     `RULES.md` (Event Data Resync, Screen Mode Data Freshness, the 30 s
     re-attempt) change, and `tokenError` becomes the refusal.
7. **Presence when a connection drops.** Two cases:
   - **A socket that never closes**: sweep by alarm, as prototyped. The limit
     (45 s proposed, three missed pings) is how long a vanished Screen Output
     is still counted. The alarm wakes the object about 160 times an hour per
     Event while anyone is present; its cost is not measured.
   - **A cut the object sees**: tell watchers at once, as prototyped, or hold
     the member for a grace period as Ably does. Without one, every blip shows
     a Screen Output leaving for a quarter of a second.
8. **No polling fallback**: accept, on the strength of the degraded re-read.
9. **The 64 KiB bound** (ADR-0004): keep it as a design rule, or raise it.
10. **Cutover order and the Release.** Whether anything is an operator step
    beyond Deploy, and so a major changeset: ADR-0119 deploys a changed Part
    itself, which leaves removing `NUXT_ABLY_API_KEY`. #189's "stay on the Free
    plan" decision is superseded, and `README.md`, `PRODUCT.md` and the root
    `AGENTS.md` name Ably.

## What is not measured

- **A venue's network, and another continent.** Staging was probed from one
  machine near one Cloudflare location. The prototype's README has the three
  commands to run it again: a separate `stream-realtime-prototype` Worker on
  `workers.dev` that touches no binding the app uses, the probe, and its
  deletion. Deploying is a human's call, by hand into the Staging account
  (ADR-0130): never through the Deploy workflow, which deploys only Releases and
  runs Staging's acceptance gates (ADR-0129), and never on Stream Keepr's
  Staging hostname.
- **What a run bills**: the requests and duration of one probe run.
- **Hibernation itself**, and the cause of the second run's 0.4 s stall.
- **A gap older than the log, on Staging.** Shown locally only.
- **A machine that vanishes, on a real network.** Locally the sweep removed it;
  what Cloudflare itself reports for a client that lost power, and when, is
  not known.
- **The client in a browser.** It ran under Node. No page, no OBS, no adapter to
  `RealtimeTransport`, no unit tests, and not the default heartbeat.
- **The reworked Worker on Staging**: attachments in place of tags, the sweep's
  alarm, and what both bill.
- **OBS.** A browser source reconnecting, and whether a hidden source throttles a
  heartbeat timer.
- **Ably's own delivery latency** on the same rig, for comparison.
  `scripts/measure-realtime-fanout.mjs` counts messages and does not time them.
- **Stream Keepr's suites on a build with the custom entry.** The build, the
  dry run and the socket probe pass; no suite was run against it.
- **Development on Stream Keepr itself.** The dev proxy and the Worker beside
  were tried on Score Keepr, which has no other binding. Whether Vite's own
  socket and hot reload are undisturbed was not checked.
- **A Part asking the app who the caller is** over a service binding.
- **Score Keepr's needs beyond its spec.** It is scaffolded, not built; section 6
  reads the spec and nothing else.

## Appendix: the local run

`PROBE_RETENTION_MS=3000 PROBE_IDLE_MS=20000 node probe.mjs` against
`wrangler dev` on loopback, 2026-11-18, milliseconds:

```json
{
	"cycles": 200,
	"connectMs": { "n": 5, "p50": 12.5, "p95": 26.1, "max": 26.1 },
	"fanOut": { "eventChannel": 5, "screenChannel": 1, "published": 400, "delivered": 1200 },
	"publishHttpMs": { "n": 200, "p50": 2.8, "p95": 5, "p99": 7.5, "max": 8.1 },
	"publishRpcMs": { "n": 200, "p50": 1, "p95": 1, "p99": 2, "max": 2 },
	"eventDeliveryMs": { "n": 1000, "p50": 1.6, "p95": 3.2, "p99": 4.7, "max": 5.4 },
	"screenDeliveryMs": { "n": 200, "p50": 1.7, "p95": 3.4, "p99": 4.9, "max": 5.8 },
	"catchUp": { "missed": 50, "replayed": 50, "ms": 4.3 },
	"continuityLost": { "staleEpoch": "resumed=false", "prunedGap": "resumed=false, nothing replayed" },
	"presence": { "entered": 3, "leaveNoticedMs": 0.7 },
	"afterIdle": { "idleMs": 20000, "publishHttpMs": 10.5, "presence": "intact" },
	"stats": { "sockets": 5, "logRows": 2 }
}
```

## Appendix: the Staging runs

`PROBE_IDLE_MS=90000 node probe.mjs`, then `PROBE_IDLE_MS=1000`, against the
Worker on `workers.dev` in the Staging account, 2026-11-18, milliseconds:

```json
{
	"cycles": 200,
	"connectMs": { "n": 5, "p50": 2630.3, "p95": 2646.5, "max": 2646.5 },
	"fanOut": { "eventChannel": 5, "screenChannel": 1, "published": 400, "delivered": 1200 },
	"publishHttpMs": { "n": 200, "p50": 52.4, "p95": 72.2, "p99": 82.2, "max": 108.8 },
	"publishRpcMs": { "n": 200, "p50": 33, "p95": 37, "p99": 42, "max": 90 },
	"eventDeliveryMs": { "n": 1000, "p50": 51, "p95": 68.7, "p99": 80.3, "max": 107.5 },
	"screenDeliveryMs": { "n": 200, "p50": 51.3, "p95": 69.1, "p99": 82.8, "max": 106.2 },
	"catchUp": { "missed": 50, "replayed": 50, "ms": 100.9 },
	"continuityLost": { "staleEpoch": "resumed=false", "prunedGap": "not run" },
	"presence": { "entered": 3, "leaveNoticedMs": 25.2 },
	"afterIdle": { "idleMs": 90000, "publishHttpMs": 124, "presence": "intact" },
	"stats": { "sockets": 5, "logRows": 454 }
}
```

```json
{
	"cycles": 200,
	"connectMs": { "n": 5, "p50": 485.9, "p95": 500.2, "max": 500.2 },
	"fanOut": { "eventChannel": 5, "screenChannel": 1, "published": 400, "delivered": 1200 },
	"publishHttpMs": { "n": 200, "p50": 46.2, "p95": 64.7, "p99": 373.3, "max": 491.6 },
	"publishRpcMs": { "n": 200, "p50": 26, "p95": 40, "p99": 296, "max": 474 },
	"eventDeliveryMs": { "n": 1000, "p50": 44.5, "p95": 62.7, "p99": 370, "max": 493.5 },
	"screenDeliveryMs": { "n": 200, "p50": 44.8, "p95": 63.4, "p99": 370.9, "max": 493.7 },
	"catchUp": { "missed": 50, "replayed": 50, "ms": 98.8 },
	"presence": { "entered": 3, "leaveNoticedMs": 14.7 },
	"afterIdle": { "idleMs": 1000, "publishHttpMs": 44.8, "presence": "intact" }
}
```

## Sources

- Cloudflare: Durable Objects pricing, limits, WebSockets, lifecycle, code
  updates, data location (`developers.cloudflare.com/durable-objects/`).
- Ably: `ably.com/pricing`, `ably.com/docs/platform/pricing`,
  `/platform/pricing/free`, `/platform/pricing/limits`.
- #189 for the fan-out and volume figures; ADR-0004, ADR-0010, ADR-0022,
  ADR-0023.
