# ADR-0155: An Invitation is answered only with the secret its emailed link carries

Accepted · 2026-11-20 · #1384 · Amends ADR-0114, ADR-0116

### Decision

**An Invitation's link carries a secret, apart from its id, and only the invitee is sent it.** Keepr Accounts makes 32 random bytes for each Invitation it issues, emails them in the link's fragment beside the id (`/invitation#id=…&secret=…`), and keeps only their SHA-256 digest, in a table of its own, `invitationSecret`, which the library does not know. The secret is in no answer to the inviter, no listing, no Audit Record row and no log. The id stays what names the Invitation to its Organisation's managers and in the Audit Record.

**Reading the offer, accepting as a new User, accepting as an existing User and declining each need the secret**, through Keepr Accounts' own routes under `/api/invitation`. An id with no secret, or one not its own, is answered as no Invitation at all, before its state is read, so the id alone learns nothing. The library's `/organization/get-invitation`, `/organization/list-user-invitations`, `/organization/accept-invitation` and `/organization/reject-invitation`, which take an id alone, are closed; an existing User accepts through `/api/invitation/accept-signed-in`, which checks the secret and then hands the library's acceptance their Session. The library sends no Invitation email: one it made would have no secret.

**Inviting needs a sign-in no older than ten minutes**, as changing a member does (ADR-0116), and **one inviter makes at most 50 Invitations to an Organisation in an hour**. **An admin cannot replace an owner's offer**: inviting an address that holds a pending owner Invitation is refused `OWNER_REQUIRED`, as offering the owner role is.

**An offer stands no longer than its inviter's standing.** Removing a member cancels the Invitations they offered to that Organisation that are still open; disabling a User cancels those they offered to any. Each is a cancellation in the Audit Record, saying why.

**A membership is unique on Organisation and User**, held by the table, so two accepts at once leave one. **An invited address must be one plausible mailbox**, `local@domain.tld`. **A stored Invitation whose App roles cannot be read is listed offering none**, rather than failing the listing.

**The migration that adds the secret cancels every Invitation then open**, each a cancellation in the Audit Record naming no actor (`no-secret`): none could be answered without a secret, and none should stay answerable by id. Its invitee is invited again. It also removes any second membership of one User in one Organisation, keeping the first joined, before the index makes one impossible.

### Why

- **The id was the whole credential, and it was not secret.** It was answered to the inviter, listed to every manager and written in the Audit Record; accepting with it created a verified User with a password the caller chose. Any admin could invite an unregistered address, accept it themselves and own that User, and with it a later owner Invitation to the same address. The emailed link is what proves an address, so only what the email alone carries can prove it.
- **A table of Keepr Accounts' own keeps the digest out of the library's reach.** An additional field on the library's `invitation` would be returned by any of its routes that answer an Invitation; a table it does not know is returned by none.
- **The inviter loses the link to copy.** It was the leak. An email that does not arrive is replaced by inviting the address again, which only a manager can do and the Audit Record shows.
- **Inviting is a change of access in waiting.** An offer becomes access on acceptance with no further check by its inviter, so it asks the same recent sign-in as a change, and is capped so that a stolen Session cannot flood an Organisation or an inbox.

### Rejected alternatives

- **Hiding the id instead.** It names the Invitation to those who cancel it and in the Audit Record; a second value that only the invitee holds is simpler than removing the id from every place it is rightly seen.
- **Re-sending each open Invitation with a secret in the migration.** A migration sends no email; a deploy step that does would be an operator step for a handful of Invitations a manager re-sends in a moment.
