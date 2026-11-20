---
'@keepr/accounts': patch
---

The shared layer's identity resolver shares the Identity Proofs and keys it verifies across an App's Worker isolates, through the Worker's Cache API (#1375). Nothing Keepr Accounts does changes. There is no step beyond Deploy.
