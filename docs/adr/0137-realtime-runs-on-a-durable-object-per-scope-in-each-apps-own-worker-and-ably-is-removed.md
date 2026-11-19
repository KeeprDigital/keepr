# ADR-0137: Realtime runs on a Durable Object per scope in each app's own Worker, and Ably is removed

Accepted · 2026-11-19 · [#1311](https://github.com/KeeprDigital/keepr/issues/1311), part of [#1310](https://github.com/KeeprDigital/keepr/issues/1310), from the spike [#1295](https://github.com/KeeprDigital/keepr/issues/1295) · Amends ADR-0004, ADR-0010, ADR-0023 and ADR-0028 · Supersedes #189's decision to stay on Ably's Free plan

Stream Keepr's realtime ran on Ably: the server published over REST, pages subscribed with Ably's SDK, and a Screen Output entered presence on its Screen's channel. #1295 asked whether it could move onto Cloudflare, and the owner set one constraint: what is built must serve every app in the workspace that needs realtime.

### Decision

**Realtime moves off Ably, all of it, onto Durable Objects with hibernating WebSockets.** No channel kind stays behind. Ably stays wired until production has run a show on the object, then it is removed.

**One object per scope the app names, holding every socket of that scope.** For Stream Keepr the scope is an Event; Score Keepr names its own. The object treats a channel as an opaque string. It gives each channel a sequence, fans a publish out to the sockets attached to it, and orders every message of the scope.

**Each app holds its own objects in its own Worker. There is no realtime service.** What is shared is source:

| Piece | Home |
| --- | --- |
| The object's class, its wire protocol and the client transport, with no framework and no product's name in them | `@keepr/realtime` |
| The Worker entry that exports the class and hands a socket to it, the server's publish by RPC, and the Worker that holds the class beside `nuxt dev` | `packages/nuxt-layer` |
| The scope, the channel names, the route, and who may hear and enter what | Each app |

The app answers one port: given a request, the identity, the scope, and the channels it may hear and enter. The transport enforces the answer.

**The server publishes by RPC on the app's own binding**, and no client publishes. A message still announces and a read is still the authority.

**The object keeps a catch-up log for 2 minutes**, in its SQLite. A socket that reattaches with the sequence it held is replayed what it missed. When the log cannot cover the gap, or the object's storage is not the one the client knew (its epoch differs), the attach says continuity was lost and the consumer re-reads, as Reconnect Resync does today.

**A Session's socket is authorized by its cookie on the upgrade**, and may hear its Event's channel and its Screens'. The upgrade checks `Origin` as the Session boundary checks a state-changing request (ADR-0010), since a page on a sibling subdomain can open a socket that carries the cookie.

**A Screen Output presents its Screen Output Asset Capability to an HTTP route and is given a ticket for the socket.** The ticket is short-lived and admits one socket, so a reconnect asks for another. It may hear its own Screen's channel and enter its presence, nothing else. Regenerating the capability closes the sockets it admitted at once.

**A refusal is an accepted socket closed with a code.** A page cannot read a refused upgrade's status, so a refusal otherwise looks like a dead network.

**Reconnection, backoff and heartbeat are the client transport's own**, and ADR-0023's rules hold there: a Realtime Subscription is held until disposed, and retries have no limit. The values, provisional until #1318 has run them over a show's length:

| What | Value |
| --- | --- |
| Retries | The first after 250 ms, doubling to 4 s, then 5, 10 and 20 s, then one every 30 s |
| Heartbeat | A ping every 15 s, answered without waking the object; the socket is given up when no pong comes in 5 s |
| Connect timeout | 10 s |
| The fault is shown | Once the transport has been without a connection for 8 s, whatever the count of retries |
| A page's `online` and `visibilitychange` | Cut the wait before the next retry |

**Presence is held in each socket's attachment.** A reconnecting client names itself, replaces the socket it lost and keeps its place. Three cases end a presence entry:

- **The client leaves, or its capability is regenerated:** watchers are told at once.
- **Its socket closes:** the member is held for 5 s, and watchers are told only if it has not returned.
- **Its socket never closes:** an alarm sweeps a member whose pings stopped 45 s ago (three missed), and watchers are told then. The alarm runs only while anyone is present.

**There is no polling fallback.** Where WebSockets are blocked, the slow re-read while realtime is degraded is the fallback that already exists.

**A message stays within 64 KiB** (ADR-0004), now as a design rule: a WebSocket message may be 32 MiB.

**Under `nuxt dev` the class is in a Worker beside the dev server**, reached through Nitro's dev proxy on the path production uses. The layer owns that Worker and the app's `pnpm dev` starts it. Whether its binding lives in a Wrangler environment or a separate dev config is #1314's to decide. The preview and the integration suites run the built Worker, so they take production's path.

**Stream Keepr moves behind the two ports it has**, the server's publish functions with `PublishToScreenChannels`, and `RealtimeTransport`. One flag per Installation chooses the transport for the server and its pages together, so an Installation is on one. Staging turns it on first. Rollback is the flag and a reload.

### Why

- **Money does not decide it.** Both are free at today's load. At ten times it, Durable Objects cost at most $0.15 a month, and Ably's Free package is 1.1 to 1.6 times from its monthly allowance.
- **What Ably costs is not money.** A key and an Ably app per Environment. Nine realtime integration files that CI cannot run, because it has no key. A Free package that throttles a show to 1,600 messages an hour once its month is spent, where a Durable Object bills an overage.
- **The object gives more than it takes.** One single-threaded object orders an Event's messages across its channels, which Ably did not. A publish is an RPC in the same account. A regenerated capability stops hearing at once, where an Ably token ran out its 10 minutes. A deploy leaves hibernating sockets connected.
- **The price is owning what Ably's SDK did**: reconnection, backoff, heartbeat and presence. #1295's client prototype, 375 lines, kept ADR-0023's rules through cut connections, a silent network and an outage longer than the log.
- **Per app, as each app owns its database.** No deploy order between apps, no shared failure, and who may hear a channel stays the app's own rule. The class and protocol are shared source either way, so moving to one service later is a hosting change.
- **The app's own Worker, not a second deployable.** The caller is authorized in process, and nothing deploys before or after it. It costs a custom Worker entry and a second process in development.
- **A ticket, not a subprotocol.** A browser cannot set `Authorization` on a WebSocket. A subprotocol would put the long-lived capability in the handshake's headers on every reconnect; a ticket keeps it on the HTTP surface that already takes it.
- **A time for the fault, not a count.** A connect timeout stretches each retry, so a count of retries is reached at no predictable moment. 8 s is about when today's five quick retries are spent.
- **A grace period on a closed socket.** Without one, every blip showed a Screen Output leaving for a quarter of a second in the prototype. 5 s covers the first four retries.

### Rejected

- **Stay on Ably.** Nothing forces a move at today's load. It keeps the key per Environment, the tests CI cannot run, and the cliff.
- **Move part.** Keeping one channel kind on Ably keeps the key, the SDK and the quota, and adds a second transport to reason about.
- **One realtime service every app binds.** It needs a deploy order as Keepr Accounts has (ADR-0120), and must ask each app who may hear what. What would reopen it: Stream Keepr showing Score Keepr's tournament live. Try a service binding into Score Keepr's namespace first.
- **A Part that owns the socket route** (ADR-0119). The same shape in development and production, at the cost of a second deployable per app and a call back to the app to ask who the caller is.
- **One object per channel.** It gives no order across an Event's channels and costs an RPC per channel on every write.

### What a Durable Object cannot match

- **Fan-out from the edge nearest each client.** An object lives in one place, near its first request, and does not move. That fits an Event at one venue; a remote operator pays the distance.
- **Multi-region failover and a vendor's channel inspector.** Workers observability stands in for the second.

### Evidence

From #1295's throwaway prototypes, never merged (`spike/1295-realtime-do-prototype`, `spike/1295-nitro-durable-object`; the research note is PR #1309's diff):

- **The object, deployed in the Staging account**, twice from one machine near one Cloudflare location, with 3 Screen Outputs and 2 operator pages: 400 published and 1,200 delivered with no gap or reorder; delivery p50 51 and 45 ms, p95 69 and 63; a Screen Output dropped across 50 messages was replayed exactly those 50. The second run stalled once for about 0.4 s, cause not found.
- **The client transport, under local `workerd` and Node**, with a 1 s heartbeat: 5 cuts during 200 Takes, all heard once and in order; a silent network noticed by the heartbeat; an outage longer than the log told each channel of its loss exactly once; a vanished machine swept from presence at the limit.
- **A Nuxt Worker.** Nitro's own entry exports only `default`, and a route cannot return the object's `101`. A custom entry for production builds does both: Stream Keepr's `pnpm build` and `pnpm worker:dry-run` pass with it. `nuxt dev` cannot hold the class; a Worker beside it, reached by Nitro's dev proxy with `ws: true`, can.

Not measured, and so #1318's gates before a live show: a browser and OBS as Screen Outputs, a hidden browser source included; a venue's network, and a client far from the object; a machine that loses power; the default heartbeat over a show's length; what a show bills. The ticket, the fault's 8 s, the `Origin` check and the grace period were not prototyped.

### Consequences

- **`RULES.md` and each guide change with the ticket that changes what is true.** Until an Installation's flag is on it runs on Ably, and ADR-0010's token grant and ADR-0023's token recovery describe it.
- **A Screen Output's reconnect is an HTTP request, then a socket.** The client transport asks for its address each time it connects.
- **Half of today's transport has no successor.** An Ably token covers one Event, so the plugin tracks coverage, mints and holds subscriptions until covered. A socket carries its credential on the upgrade.
- **The token-wait clauses become the refusal.** Where ADR-0023 and ADR-0028 wait on a token, the new transport waits on a refused socket, and `tokenError` stands for the refusal.
- **Only a Session's grant read channel history, and nothing ever called it.** The grant ends with the token route.
- **CI runs every realtime test** once Stream Keepr's pages are on the object: it runs in local `workerd` with no credential. The root `AGENTS.md` exception goes with Ably (#1319).
- **Removing Ably is a major changeset.** The operator deletes `NUXT_ABLY_API_KEY` from each Installation and closes the Ably apps.
- **An Environment's included requests and duration are shared by every app in it** (ADR-0122). Stream Keepr at ten times today's load uses about 1.5 million requests against the 1 million included.
- **A publish reads every socket's attachment in the scope.** Fine for the dozens an Event has; not shown for thousands.
- **The terms that move with the transport**, Realtime Subscription and Reconnect Resync among them, move to the root `GLOSSARY.md` in the change that moves them.
