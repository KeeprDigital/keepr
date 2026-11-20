---
'@keepr/accounts': patch
---

A User always has a name. Keepr Accounts refuses a blank one, empty once trimmed or not text, 400 `NAME_REQUIRED` on every path that sets a name: accepting an Invitation, claiming the first Keepr Administrator, and a change on the profile, where Better Auth's `/update-user` saved one until now. The profile says "Enter your name." beside the name, and a name is kept trimmed. No stored name is rewritten.
