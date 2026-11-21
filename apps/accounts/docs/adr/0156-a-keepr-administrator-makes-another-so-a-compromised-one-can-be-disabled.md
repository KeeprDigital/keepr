# ADR-0156: A Keepr Administrator makes another, so a compromised one can be disabled

Accepted · 2026-11-20 · #1385 · Amends ADR-0115

### Decision

**A Keepr Administrator makes another User a Keepr Administrator**, from `/platform`, through Keepr Accounts' own route `POST /api/platform/users/:userId/keepr-administrator`. It asks for a sign-in no older than ten minutes, as every other change a Keepr Administrator makes does, and is a row of the Audit Record (`user.keepr-administrator-granted`) naming who granted it to whom, written in one batch with the grant. A User who is one already is refused 409 `ALREADY_A_KEEPR_ADMINISTRATOR`.

**Nothing takes it away.** No route revokes the role; a Keepr Administrator who must no longer act is disabled, which ends every Session they have and mints them no Identity Proof (ADR-0117).

ADR-0115's "no request can create a Keepr Administrator" now reads: no request creates the *first* one. The admin add-on's routes stay closed; this is Keepr Accounts' own, narrower route, open only to a Keepr Administrator.

### Why

- **One Keepr Administrator cannot be disabled.** A Keepr Administrator cannot disable themselves (ADR-0117), and the first is the only one the claim makes. If their account were compromised, nobody could shut it out short of writing to the database by hand. A second, made in advance, can.
- **The power is the one they already hold.** A Keepr Administrator can already disable any User and manage any Organisation; making another adds no reach the role does not have, and the Audit Record shows who made whom.

### Rejected alternatives

- **A second First Administrator Claim.** The command writes nothing once a Keepr Administrator exists, so that a written claim cannot be used to seize the platform later (ADR-0115). Reopening it for a second would reopen that.
- **Letting a Keepr Administrator disable themselves.** It shuts out a compromised account only if its owner notices first, and lets a slip leave the platform with none.
- **Revoking the role through a route.** Disabling already stops a compromised Keepr Administrator at once; a revocation route would be one more power for an attacker holding a Keepr Administrator's Session to turn on the others.
