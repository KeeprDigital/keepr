# ADR-0117: A Keepr Administrator runs the platform from routes that grant them no membership

Accepted · 2026-11-17 · #1228, #1253

### Decision

**A Keepr Administrator's screen is `/platform`, served by Keepr Accounts' own routes under `/api/platform`.** They list every Organisation, create one, find any User by name or email, disable a User and enable them again, and read the Audit Record, newest first. Each route refuses 403 `NOT_A_KEEPR_ADMINISTRATOR` to anyone else. The admin add-on's routes stay closed (ADR-0112). A Keepr Administrator manages any Organisation's members on `/members?organisation=<id>`, through the routes and the standing ADR-0116 gives them.

**Creating an Organisation does not make its creator a member.** Keepr Accounts writes the Organisation and an Invitation for its first owner itself, with the App roles chosen for them, rather than through the organisation add-on, which makes whoever creates an Organisation its owner. Until the invitee accepts, the Organisation has no member. Its name must be one no other Organisation has: 409 `ORGANISATION_EXISTS`.

**Disabling a User ends every Session they have, in the same action**, and an Identity Proof is already refused to a disabled User (ADR-0113), so an App stops recognising them within five minutes. A Keepr Administrator cannot disable themselves: 409 `CANNOT_DISABLE_SELF`.

**Creating an Organisation, disabling a User and enabling one need a sign-in no older than ten minutes** (`requireRecentSignIn`, ADR-0116). Reading needs none.

**The organisation add-on's `/organization/update` and `/organization/delete` are closed.** Nothing in Keepr renames or deletes an Organisation, and they would be open to its owners and leave no row in the Audit Record.

**Each action is in the Audit Record**: the Organisation created and its first owner invited, a User disabled or enabled, and the Sessions disabling ended, a row of its own (#1228 § Administration and audit).

What each of these makes true is in `apps/accounts/RULES.md` under Keepr Administrator.

### Why

- **Being a Keepr Administrator grants no App access by itself** (#1228 story 49). Made the creator's owner, a Keepr Administrator would hold an Organisation role in every Organisation they created, and every Identity Proof that named it; support access must be a deliberate, visible act.
- **An Organisation is run by its own people.** Naming the first owner by Invitation means the person who will run it sets up their own sign-in and accepts, as everyone else joins (ADR-0114).
- **Enabling a User is as sensitive as disabling one.** It restores sign-in to an account someone judged compromised, so it asks for the same recent sign-in, beyond the spec's list.
- **Disabling oneself would leave the platform without a Keepr Administrator** if they were the last, and only the First Administrator Claim, which no longer works once one has existed, makes one.

### Rejected alternatives

- **The organisation add-on's create, then the Keepr Administrator removing themselves.** Two writes where one is wanted, a window in which they are its owner, and the last-owner rule would refuse the removal until the invitee accepted.
- **The admin add-on's `ban-user` and `revoke-user-sessions`.** They admit any Keepr Administrator to everything the add-on does, impersonation included, which is why its routes are closed; and they ask for no recent sign-in and leave no row in the Audit Record.
- **A Keepr Administrator choosing an Organisation by switching the one they work in.** They are a member of none they did not join, so there is nothing to switch to; naming it in the address needs no membership.
