---
'@keepr/stream': patch
---

The Worker's log says where a write's time went on its way to its Event's realtime object (#1363). Each write that calls the object logs one `realtime_write_timed` line: the whole write, how long it spent learning who it belongs to and whether Keepr Accounts had to be asked for an Identity Proof while it waited, its time and queries in D1, its calls to the object and any that failed, and how many requests the Worker's isolate had served, a first being a cold start. There is no step beyond Deploy.
