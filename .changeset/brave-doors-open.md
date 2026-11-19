---
'@keepr/stream': patch
---

The Worker binds a Durable Object, `REALTIME`, in every Environment, and its entry exports the object's class and hands a socket on `/realtime/socket` to it (ADR-0137, ADR-0138). Deploy creates the class with the Worker, from the `migrations` entry in `wrangler.jsonc`: there is no step beyond Deploy. Nothing publishes to the object yet and every socket is refused, so realtime is Ably's until Stream Keepr's pages move onto the object.
