---
'@keepr/accounts': patch
---

An Invitation is accepted only by whoever holds the invited address (#1384, ADR-0155). Its emailed link carries a secret the inviter is never shown, and reading, accepting and declining it need that secret; the inviter is no longer shown the link to copy. Inviting needs a sign-in from the last ten minutes and is capped at 50 an hour per inviter and Organisation; an admin cannot replace an owner's offer; removing a member or disabling a User cancels the Invitations they offered. Deploying cancels every Invitation then open, each recorded in the Audit Record: tell those who invited people to invite them again. There is no step beyond Deploy.
