# ADR-0114: Organisation roles govern membership; App access is a role each App defines

Accepted · 2026-11-17 · #1228, #1250 · Amended by ADR-0155: the link carries a secret emailed to the invitee alone, and is no longer shown to copy

### Decision

**An Organisation role (owner, admin, member) governs only the Organisation's membership**: who may invite people and set access. It never says what anyone may do inside an App. Owners and admins invite; only an owner invites an owner. Ordinary Users cannot create an Organisation.

**What a member may do in an App is App access: one App role, or none, per member and App.** The App roles are those the App declares in the App registry (`packages/nuxt-layer/shared/utils/appRegistry.ts`). App access is Keepr Accounts' own table, `appAccess`, keyed by member and App, and holds names from the registry, so adding an App or a role changes the registry, not the identity schema.

**People join by Invitation.** An Invitation is the organisation add-on's, carrying the Organisation role and, as Keepr's own field `appRoles`, the App role offered in each App. It lasts seven days, inviting the same address again replaces it, and the App roles it offers are checked against the App registry when it is created. When it is accepted, Keepr Accounts copies those roles into App access.

**A person with no User accepts by choosing a name and a password.** Sign-up stays closed, so Keepr Accounts creates the User itself, with the email verified because the emailed link proved it, signs them in and accepts the Invitation as them, in the order spike 3 found (#1256): read the Invitation, refuse an address that has a User, check the minimum password length, create the User (the breached-password check runs there), sign in, accept.

**The Invitation is emailed through the email seam, and its link is also shown to copy.** The email is sent after the response; a failed send leaves the Invitation standing.

**The member and pending-Invitation limits are 10,000 per Organisation**, far above the library's hundred.

**Creating an Organisation, creating an Invitation and accepting one are each in the Audit Record**, with who and when.

What each of these makes true is in `apps/accounts/RULES.md` under Organisation and Invitation.

### Why

- **Two kinds of role, kept apart.** Who may hand out access and what a person may do in an App are different questions. One role answering both would make an Organisation admin an admin of every App, and each App's needs would leak into the Organisation's.
- **The App owns the meaning of its roles.** Keepr Accounts stores and checks names; the App decides what `admin` permits. The registry is the one place both read.
- **The library does part of this.** Its organisation add-on gives Organisations, members, Invitations, the owner-only rule and re-invite replacement. It has no App access, no way to register through an Invitation while sign-up is closed, and its server-side user creation checks no minimum length (#1256). Keepr Accounts adds those through the add-on's hooks (`server/utils/organisations.ts`), so the library's own accept route, which an existing User will use, copies App access too. Invitations are made through Keepr Accounts' own route (ADR-0116).
- **The copy link is a fallback, not the channel.** Email may fail while Cloudflare's sending domain is being set up (#1228 § Further Notes); an inviter is never blocked by it.

### Rejected alternatives

- **App roles as the organisation add-on's roles** (`stream:admin` as a member role). The library's role checks would then govern App access, and every App role would need the add-on's access-control setup.
- **App access as a column on the member.** A new App would be a migration.
- **Opening sign-up for invitees, gated on an Invitation.** It reopens the route closed so that nobody signs themselves up (ADR-0112), for one caller.
