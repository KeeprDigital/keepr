---
'@keepr/accounts': minor
---

A Keepr Administrator can make another User a Keepr Administrator from the platform screen, so one whose account is compromised can be disabled by another (#1385). Keepr Accounts' request surface is now closed by default: every response carries a Content Security Policy that forbids framing, HSTS, `nosniff` and a Referrer Policy, and API answers are never stored; Better Auth's routes are closed but for the ones its pages and the Apps use; accepting an Invitation and claiming the first Keepr Administrator refuse a cross-site request; a disabled User's open Session is ended the first time it is used; a User's name is at most 100 characters with no control characters; a Return Address with a control character is refused; and Organisation names are compared in any script. Each administrative change is written in one batch with its Audit Record row, and a First Administrator Claim now lasts a day. There is no step beyond Deploy.
