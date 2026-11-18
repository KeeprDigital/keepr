---
'@keepr/stream': patch
---

A deploy refuses an Installation whose Worker lacks a required secret, naming each one missing and the command that sets it, before it changes anything (ADR-0128). A new Installation's secrets are set before its first deploy.
