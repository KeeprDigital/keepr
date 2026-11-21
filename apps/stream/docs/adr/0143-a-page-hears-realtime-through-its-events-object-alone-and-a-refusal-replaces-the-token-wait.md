# ADR-0143: A page hears realtime through its Event's object alone, and a refusal replaces the token wait

Accepted · 2026-11-19 · [#1317](https://github.com/KeeprDigital/keepr/issues/1317), part of [#1310](https://github.com/KeeprDigital/keepr/issues/1310) · Amends ADR-0010, ADR-0023, ADR-0028 and ADR-0141 · Amended by ADR-0162

ADR-0137 moved realtime onto a Durable Object per Event, and ADR-0140 made the move one cut with no flag: the server's half is #1316, who a socket's caller is #1315, and the pages' half is this. Until now a page connected to Ably with a token from `GET /api/realtime/token`, which covered one Event, so its transport minted, tracked what a token covered, and held each Realtime Subscription until one did. ADR-0023 and ADR-0028 are written in those terms. ADR-0137 said the token-wait clauses become the refusal and left the particulars to the change that made them true.

### Decision

**The app's `RealtimeTransport` is the transport over an Event's object, and no other.** `app/plugins/realtime.client.ts` provides `createSocketRealtimeTransport`, one client transport of `@keepr/realtime` per Event. Ably's SDK, the plugin that drove it, `GET /api/realtime/token`, `getAblyClient` and every reader of `NUXT_ABLY_API_KEY` are removed. No consumer changes: each already went through the port.

**Which address a page asks for is decided by what it holds**, read afresh for each socket.

- **A page holding a Screen Output Asset Capability** in its URL fragment, a Screen Output or a Program Monitor, presents it to `POST /api/realtime/ticket?eventId=<id>` and opens the socket with the Realtime Ticket it is given. Each socket fetches one of its own.
- **Any other page** opens `/realtime/socket?eventId=<id>` on the host that served it, `wss` or, on plain HTTP, `ws`. The browser sends its Session's cookie with the upgrade. An editor preview is one of these: it holds no capability.

A page with a capability is never let in as its Session instead. Where its ticket is refused, it is refused.

**`tokenError` is the refusal, set when it is heard.** There are no quick retries before it: a refusal is the app's answer, and a network that does not answer never gives one. The name stays, as ADR-0137 kept it. Two things are refused:

| Refused | By | It ends when |
| --- | --- | --- |
| The socket | The app's port, as a socket closed `CLOSE_REFUSED`; or the ticket's route, answering a Screen Output 401 or 403 | The client is let in, or the page leaves that Event |
| A channel | The Event's object, for a channel outside the socket's grant | The next socket asks again, or the last thing asked of the channel is disposed |

Any other failure of the ticket's route, and an answer that carries no ticket, is a failed attempt like a network that did not answer: retried as one, and never reported as a refusal.

**A refused socket's fault stands while the page is on that Event, whatever it disposes.** This departs from ADR-0023's "disposal clears the fault at once, since nothing is failing for anyone any more". The page is on an Event from the first thing it asks there until it asks something of another, leaves its room for none, or goes away, and its socket is held for that long (the client transport's hold). A page that has disposed its last Realtime Subscription on the Event is still refused there, and what it asks next would be refused too.

**A refused channel is asked again on the next socket, not every 30 s.** This replaces ADR-0023's recovery for a refused attach. Under Ably a refused attach could be a token that had failed to mint, so re-attempting could heal it. Here a socket's grant is fixed when it is accepted, so asking the same socket again has one answer; what was asked stays wanted and goes in every socket's `hello`. A refused socket is still retried without limit, from the 5 s step to one attempt every 30 s.

**The pages end their sockets on `pagehide`, and a page restored from the back/forward cache reloads**, as before.

**The token route ends, and its grant with it.** ADR-0010's dual grant, the route's exemption from the Session boundary and its own 401, and ADR-0141's account of how it asks who a request belongs to, describe nothing any more. Nothing ever read a channel's history, which only that grant gave. A Screen Output no longer hears its Event's channel: the token granted it and nothing on an output listened there (`SCREEN_CHANNEL_PROTOCOL` 2), and the object's grant is its own Screen's channel alone. Who a socket's caller is, and the Realtime Ticket, are ADR-0142's.

**Every Screen command is safe to hear twice, and that is now a rule.** The server makes a failed publish once more and cannot tell a call that failed from one whose answer was lost, so a command the first call delivered can arrive again. A command therefore says what an output is to do and never turns over what the output last did. #1316 and the debug command's change made each command so; `RULES.md` now holds every later one to it.

**ADR-0028's two token waits read as refusals.** An operator's Event Data Resync also runs when its client stops being refused, and Screen Mode Data Freshness re-reads on its slow cadence while its client is refused on the Event the page is on. Neither module changed: both read `tokenError`.

**Realtime Subscription and Reconnect Resync stay in Stream Keepr's glossary.** ADR-0137 has the terms that move with the transport move to the root `GLOSSARY.md` "in the change that moves them". This is not that change. A term's glossary follows its code, and this change moves no code into a package: the port that names a Realtime Subscription's four kinds, Reconnect Resync and the Realtime Event Session are all still in `apps/stream/app`, and `@keepr/realtime` holds the rule under no name. They move when a second app takes the port or Reconnect Resync, with the code.

### Why

- **One transport, because a flag keeps two true** (ADR-0140). And Ably could no longer be run: the app behind the local key was disabled, and CI never had one.
- **The capability decides, not the page's route.** It is what the page can present, and reading it per socket costs nothing. A Session fallback for a refused ticket would hand an output its Operator's wider grant, under an identity regenerating the capability does not close (ADR-0142).
- **No retries before the fault**, because the two cases no longer look alike. Under Ably a blip during an Event switch and a token that could not be minted were the same failed call. Here a blip is a socket that does not open, shown after 8 s as the connection's fault (ADR-0137), and a refusal is a code the app sent.
- **The fault outlives disposal** because of the hold. Without a hold, a Screen Output that for a moment asks nothing would close its socket and spend a ticket to return. With one, the socket of the page's Event is a standing fact about the page, and so is its refusal.
- **Retrying a refused channel on a timer would ask a question whose answer cannot change.** The next socket is the first moment it can.
- **A rule for Screen commands**, since the retry is invisible where a command is added. A command that turned something over would be done twice by a deploy that resets an Event's object.

### Consequences

- **A refused page shows its fault at once**, where it took about 8 s of failed mints before.
- **`NUXT_ABLY_API_KEY` is read by nothing.** It leaves `deploy.jsonc`'s required secrets and `secrets.jsonc`, so a deploy no longer refuses an Installation without it, and the operator deletes it once this Release is live (the changeset says how). A rollback to a Release from before this one needs it again.
- **Every realtime integration test runs with no key, in CI.** A test follows a channel as a page does, by the client transport on a socket of its server's own, and hears what the app's write announced. The suite's one server that held the Ably key, the Event ids each server minted from a block of its own so that two files on one Ably app never heard each other, the diagnosis of a rejected key and the two test-only routes that published to an object are gone: each server's objects are its own.
- **The root `AGENTS.md` loses its realtime exception to CI** (ADR-0140).
- **`tokenError` is a name from the transport that is gone.** Renaming it touches every consumer and each of the three suites on the fake, and is left to a change of its own.

### Rejected alternatives

- **Falling back to the Session when a ticket is refused.** See Why.
- **Clearing a refused socket's fault when the last Realtime Subscription on the Event is disposed**, as ADR-0023 had it. The page is still on the Event, its socket is still held and still refused, and the fault would return with the next thing asked.
- **Re-attempting a refused channel every 30 s.** See Why.
- **Keeping the token route for one Release**, for a page left open across the deploy. Such a page hears nothing either way, since the server publishes nothing to Ably (ADR-0140); it needs a reload, which the route would not give it.
- **Renaming `tokenError` here.** See Consequences.
