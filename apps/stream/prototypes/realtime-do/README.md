# Realtime on a Durable Object: throwaway prototype (#1295)

Not merged, not bound to the app. The findings are in
`apps/stream/docs/research/realtime-off-ably.md` on `spike/1295-realtime-off-ably`.

One `EventRealtime` Durable Object per Event carries the Event's channel and
every Screen channel under it: fan-out over hibernating WebSockets, a per-channel
sequence with a two-minute log for catch-up after a reconnect, and presence held
in each socket's attachment.

## Local

From `apps/stream`:

```sh
pnpm exec wrangler dev --config prototypes/realtime-do/wrangler.jsonc \
  --port 8911 --var PROTOTYPE_SECRET:local-probe --var RETENTION_MS:3000
PROBE_ORIGIN=http://127.0.0.1:8911 PROBE_SECRET=local-probe \
  PROBE_RETENTION_MS=3000 node prototypes/realtime-do/probe.mjs
```

## Staging (needs a human's go-ahead)

A separate Worker named `stream-realtime-prototype` on `workers.dev`, with its
own Durable Object namespace; it touches no binding the app uses.

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
