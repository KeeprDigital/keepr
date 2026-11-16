# ADR-0055: A stopgap public read names an Event's commentators and holding text

Accepted · 2026-10-28. Amends ADR-0010's exempt surface.

Outside tools need the commentators' names and the holding text for an Event, and have no session or Screen Output Asset Capability to present.

### Decision

**`GET /api/public/events/:id/on-air` is unauthenticated** and answers `{ eventId, eventName, holdingText, talent: [{ slot, name }] }`, `talent` being the Event's commentator 1 and 2 Talents that are set, in slot order. It sends `access-control-allow-origin: *` and `cache-control: no-store`. An unknown Event is a 404.

**Two vMix-shaped reads answer the same facts as flat rows.** `GET /api/public/events/:id/commentators` answers `[{ commentator1, commentator2 }]` and `GET /api/public/events/:id/holding-text` answers `[{ holdingText }]`, with the same headers and 404. A vMix JSON Data Source reads an array as rows and shows `null` as text, so each is a one-element array and an unset value is an empty string.

**`/api/public/` joins ADR-0010's exempt prefixes.** Everything under it is public by name, so a route belongs there only if anyone on the internet may read what it answers.

### Why

A stopgap that works now. Names and wording an operator puts on air are not secret; nothing else is exposed.

### Consequences

- Anyone can enumerate Events by id and read their names, commentator names and holding text.
- Contradicts ADR-0010's rejection of a stopgap boundary only in spirit: that rejected a shared token in front of private routes, not a public read of on-air text.
- Replace with a capability- or token-scoped read when a real integration needs one.
