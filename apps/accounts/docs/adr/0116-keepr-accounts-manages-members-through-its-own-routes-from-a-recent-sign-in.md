# ADR-0116: Keepr Accounts manages members through its own routes, from a recent sign-in

Accepted · 2026-11-17 · #1228, #1252

### Decision

**Members are managed through Keepr Accounts' own routes, under `/api/organisations/:id/members`.** They list an Organisation's members with their Organisation role and App roles, set or remove one App's access, change an Organisation role and remove a member. The organisation add-on's `/organization/update-member-role` and `/organization/remove-member` are closed, as the admin add-on's routes are (ADR-0112).

**Who may manage, and how far, is decided in one place**, `managingStanding` in `server/utils/memberManagement.ts`. An owner or admin of the Organisation manages it; a Keepr Administrator manages any Organisation as its owner would (#1228 story 48); anyone else is refused 403, an unknown Organisation included. Only an owner, or a Keepr Administrator, changes an Organisation role or removes an owner. The last owner is never demoted or removed: the check is part of the write, so two made at once cannot both pass it.

**A change needs a sign-in no older than ten minutes**, Keepr Accounts' own check, `requireRecentSignIn`. A sign-in's age is its Session's: renewing a Session does not make it recent. Listing needs none. An older sign-in is refused 403 `RECENT_SIGN_IN_REQUIRED`, and the page asks the User to sign in again. The same check is what creating an Organisation and disabling a User will need.

**Each change is in the Audit Record**, with who, when, the Organisation, the User changed, what they had before, and the standing the change was made with.

**A write to these routes from another origin's page is refused** before its Session is read, by the shared layer's cross-site write check, which Stream Keepr's API boundary also uses (ADR-0010).

What each of these makes true is in `apps/accounts/RULES.md` under Members.

### Why

- **The library's routes could not carry the rules.** They ask for no recent sign-in (the library's freshness check is off, ADR-0112, #1249), admit no Keepr Administrator who is not a member, and know nothing of App access, so a member's App access would outlive a change made through them unrecorded.
- **One decision about standing serves every screen.** The Organisation's own member screen and the Keepr Administrator's screens call the same functions, so who may manage cannot differ between them.
- **The Session's start is the sign-in.** It is the one time the library keeps that a renewal does not move, and signing in again starts a new Session.
- **An admin cannot remove an owner.** Removing an owner takes away more than demoting one, which only an owner may do.

### Rejected alternatives

- **The library's routes, with its member hooks enforcing the rest.** Its hooks are handed the User but not the Session, so they cannot tell how recent the sign-in is, and its permission check would still refuse a Keepr Administrator who is not a member.
- **The library's freshness setting at ten minutes.** It would close a User's own list of Sessions ten minutes after signing in, the reason it is off.
