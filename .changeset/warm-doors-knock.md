---
'@keepr/stream': minor
---

A realtime socket on `/realtime/socket?eventId=<id>` is let in as a Session or as a Screen Output, and as nobody else (ADR-0137, ADR-0142). A Session's socket, opened by the app's own page, may hear its Event's channel and its Screens' and enter a Screen's presence. A Screen Output presents its Screen Output Asset Capability to `POST /api/realtime/ticket?eventId=<id>` and is given a Realtime Ticket that lasts 30 s and admits one socket, onto its own Screen's channel alone. Regenerating a Screen's capability closes the sockets its outputs hold at once. Everyone else is answered a socket closed with a code a page can read. The deploy's migration adds the `realtime_tickets` table: there is no step beyond Deploy. No page opens the socket yet and nothing publishes to it, so realtime is still Ably's.
