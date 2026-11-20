---
'@keepr/stream': patch
---

One realtime socket can no longer cost its Event's object without bound (#1387). A socket that sends an over-long frame, a `hello` of too many entries, or frames too fast is closed, and a channel a `hello` names more than once is caught up once. One User holds at most 32 sockets in an Event, a socket is closed after an hour for its caller to be let in again, and a socket whose peer has gone silent is swept whether or not it is present on a Screen. A publish over 64 KiB, or with any delivery that is not one, is refused whole. A deleted Event's object forgets its messages a minute after the delete, and of two regenerations of one Screen's capability whose closes cross, the later's outputs stay connected. Pages reconnect with jitter, a Screen Output replaced by its own late socket comes back without its Screen showing it leave, and a refused presence watch or a cut no longer shows stale members. There is no step beyond Deploy.
