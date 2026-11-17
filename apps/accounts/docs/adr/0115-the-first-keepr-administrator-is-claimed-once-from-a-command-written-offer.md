# ADR-0115: The first Keepr Administrator is claimed once, from a command-written offer

Accepted · 2026-11-17 · #1228, #1250

### Decision

**No request can create a Keepr Administrator.** The admin add-on's routes stay closed (ADR-0112), and Keepr Accounts serves none that makes one.

**The first is offered by a command, run with the operator's own Cloudflare access.** `pnpm claim-first-administrator <email>` (and `--remote <database>` for a deployed one) writes a First Administrator Claim for that address into the identity database, and its making into the Audit Record, through `wrangler d1 execute`. Both writes are conditional on no Keepr Administrator existing, so once one does the command writes nothing. It prints a link to `/first-administrator`, the claim's random id in the fragment.

**The claim page works once, and only while no Keepr Administrator exists.** Claiming creates the address's User, email verified, as a Keepr Administrator, creates the Keepr Organisation with them as owner, consumes the claim and signs them in. The claim is taken by one conditional write before the User is created, which succeeds only while no claim has been consumed and no Keepr Administrator exists, so of two claims made at once only one wins. If the User then cannot be created (a password from a breach, say), the claim is put back to be tried again.

**The Audit Record holds the claim made, the claim consumed and the Organisation created.** The command has no User, so the claim's making names the operator's login in its detail.

What each of these makes true is in `apps/accounts/RULES.md` under First Administrator Claim.

### Why

- **Nothing to switch on and forget.** Stream Keepr's first administrator needed a secret-armed endpoint that had to be enabled and then disabled again (ADR-0010). Here the power to make the first administrator is the power to write to the database, which only someone with Cloudflare access has; no network surface exists to leave open.
- **The first account is created the way every other one is**: by its own person choosing a name and password on a Keepr Accounts page, with the same minimum length and breach check.
- **It cannot be used to seize the platform later.** Once a Keepr Administrator exists, the command writes nothing and any claim already written is refused.

### Rejected alternatives

- **A bootstrap endpoint armed by a secret**, as Stream Keepr has. It is exactly what this avoids.
- **The command writes the User directly**, password hash included. The operator would choose a password for someone, or the command would reimplement the library's hashing and breach check.
- **The first User to sign up becomes the administrator.** Sign-up is closed (ADR-0112), and opening it even briefly is a race anyone can join.
