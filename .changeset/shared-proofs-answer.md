---
'@keepr/stream': patch
---

A write no longer waits on Keepr Accounts because the Worker isolate it reached had been quiet (#1375). The Identity Proof one isolate verifies, and Keepr Accounts' keys, are shared with the Worker's other isolates through its Cache API, so the proof one isolate fetched or refreshed answers the others, each verifying it again before answering from it. A proof still expires after five minutes, an ended Session still stops being admitted within five minutes, and a renewed Session cookie still reaches the browser. Where the cache cannot be reached, each isolate asks for itself as before. There is no step beyond Deploy.
