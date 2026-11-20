---
'@keepr/stream': patch
---

Stream Keepr's questions to Keepr Accounts are harder to starve, forge or over-share (#1386). A signed-out answer is remembered for 30 seconds, an unanswered question is given up after five seconds, Keepr Accounts' keys are trusted for five minutes rather than an hour, and only Keepr Accounts' own cookies are sent to it. In Staging, a Session Keepr Accounts renews now reaches the browser. A 503 while Keepr Accounts cannot be asked says one sentence, with the reason in the log. `/api/identity` answers the User and App role alone. The Session boundary also reads a request's path as sent, so a percent-encoded or backslash spelling of a private path needs a Session. There is no step beyond Deploy.
