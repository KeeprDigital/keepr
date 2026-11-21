---
'@keepr/stream': minor
'@keepr/accounts': patch
---

Realtime recovers from a publish it lost and judges a changed listener again (#1389). A publish that fails twice is tried again after the write answers, and a Screen Output re-reads every two minutes while healthy, so a lost message cannot leave program stale for long. A page whose credential changes, a Screen Output that changes Screen among them, is admitted afresh; an Event a page has left is forgotten and never reopened by a late subscription. An output that can never be let in again asks ever more rarely, and a refused ticket writes nothing. A Session renewed on a socket's admission now reaches the browser on its next request. Before a data wipe or a restore, a Graphics Administrator can end every Event's realtime with `POST /api/admin/realtime/end-events` (README § Ending every Event's realtime). There is no step beyond Deploy.
