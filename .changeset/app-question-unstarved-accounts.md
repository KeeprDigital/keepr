---
'@keepr/accounts': patch
---

An App's questions over its binding (an Identity Proof, and the keys it verifies against) are no longer counted by the rate limit, which counted every caller without an address in one bucket a stranger could exhaust for every App (#1386). A browser asking directly is still counted by its address. There is no step beyond Deploy.
