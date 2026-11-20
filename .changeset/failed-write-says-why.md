---
'@keepr/stream': patch
---

A failed request's log line (`api_request_failed`) says what failed without quoting its message: `errorCause` tells a D1 timeout, overload, lost connection, reset or other D1 refusal apart from another timeout, and `failedStep` names a write's step that failed. A write that fails with a server error now logs its `realtime_write_timed` line too, with each step's time.
