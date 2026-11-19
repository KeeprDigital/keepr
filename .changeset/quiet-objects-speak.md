---
'@keepr/stream': patch
---

The server publishes every realtime message by RPC to its Event's Durable Object, on the `REALTIME` binding, and nothing to Ably (ADR-0137, ADR-0140). There is no step beyond Deploy, and nothing to set. It ships in one Release with the pages' move onto the object. A publish that fails is logged as before, as `realtime_publish_failed`: its `reason` says why, and its `statusCode` and `errorCode` are null for a failure of the object. A Screen command that cannot be delivered still answers 502.
