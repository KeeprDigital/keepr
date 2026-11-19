# Realtime on a Durable Object: throwaway prototype (#1295)

Not merged, not bound to the app. The findings are in
`apps/stream/docs/research/realtime-off-ably.md` on `spike/1295-realtime-off-ably`.

One `EventRealtime` Durable Object per Event carries the Event's channel and
every Screen channel under it: fan-out over hibernating WebSockets, a per-channel
sequence with a two-minute log for catch-up after a reconnect, and presence held
in each socket's attachment. A socket's channels are in its attachment too, so a
page can attach and detach without reconnecting.

## Local

From `apps/stream`:

```sh
pnpm exec wrangler dev --config prototypes/realtime-do/wrangler.jsonc \
  --port 8911 --var PROTOTYPE_SECRET:local-probe --var RETENTION_MS:3000
PROBE_ORIGIN=http://127.0.0.1:8911 PROBE_SECRET=local-probe \
  PROBE_RETENTION_MS=3000 node prototypes/realtime-do/probe.mjs
```

## The client half

`client.ts` is what Ably's SDK does for the app today, over one socket to one
object: reconnection, catch-up, heartbeat, and ADR-0023's rule that nothing asked
for is forgotten on failure. `client-probe.mjs` drives it through a TCP hop it
can cut or silence, and asserts every count:

```sh
pnpm exec wrangler dev --config prototypes/realtime-do/wrangler.jsonc \
  --port 8911 --var PROTOTYPE_SECRET:local-probe --var RETENTION_MS:10000 --var STALE_MS:6000
PROBE_ORIGIN=http://127.0.0.1:8911 PROBE_SECRET=local-probe node prototypes/realtime-do/client-probe.mjs
```

It needs Node 23.6 or later, which runs `client.ts` as it is.

## Staging (needs a human's go-ahead)

A separate Worker named `stream-realtime-prototype` on `workers.dev`, with its
own Durable Object namespace; it touches no binding the app uses.
`wrangler.jsonc` names the staging account, so the deploy lands there or fails.
Never through the Deploy workflow, never on `stream.keepr-staging.digital`.

```sh
SECRET=$(openssl rand -hex 24)
pnpm exec wrangler deploy --config prototypes/realtime-do/wrangler.jsonc --var PROTOTYPE_SECRET:$SECRET
PROBE_ORIGIN=https://stream-realtime-prototype.<staging-subdomain>.workers.dev \
  PROBE_SECRET=$SECRET PROBE_IDLE_MS=90000 node prototypes/realtime-do/probe.mjs
pnpm exec wrangler delete --config prototypes/realtime-do/wrangler.jsonc
```

Run the probe from the venue's network, and once from another continent, to
read `eventDeliveryMs` with the object far from its clients. `PROBE_IDLE_MS=90000`
outlasts the object's eviction, so `afterIdle` shows a publish waking it.
