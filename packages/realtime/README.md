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
