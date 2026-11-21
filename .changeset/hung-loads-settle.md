---
'@keepr/stream': patch
'@keepr/accounts': patch
---

A Screen Output left running stays shown and current through slow or failing networks: a font load or card image that never settles fails after eight seconds, a display on its fallback face stays shown while its asset session retries, and a hung read is superseded once a message has asked for another. A Standings read carries only the rows and columns its Screen shows, and an Event data change refreshes its Screens once per request. Server time re-syncs after a page returns from the back/forward cache, times its round trip on the monotonic clock, and its status reads uncertain rather than synced on an offset it doubts. The shared layer's client state holds up under overlapping requests: a failed optimistic write rolls back only what is still its own, a loading flag stays up while any request holding it runs, Enter ignores IME composition and key repeat, and the unsaved-changes guard asks when only a route's params change (#1380). There is no step beyond Deploy.
