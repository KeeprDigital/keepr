# Keepr Accounts rules

What Keepr Accounts makes true for a User, an operator and every App. Its words are the root `GLOSSARY.md`'s, under Identity and access, and its own `GLOSSARY.md`'s; the reasons are in the decisions cited: ADR-0114 to ADR-0117 and ADR-0155 in this app's `docs/adr`, ADR-0010 and ADR-0012 in `apps/stream/docs/adr`, and the rest in the root `docs/adr`.

## Identity

- Keepr Accounts alone opens the identity database, holds the sign-in secret and runs Better Auth. No App binds the database. (ADR-0112)
- A blank `NUXT_BETTER_AUTH_SECRET` answers 503 naming it, and nobody can sign in. (ADR-0112)
- The identity schema is Better Auth's tables for its chosen add-ons, held to the library's own definitions by a test, plus App access, the Audit Record and the First Administrator Claim. The adapter runs without transactions. (ADR-0112)
- Keepr Accounts answers on `accounts.keepr.digital` in Production and `accounts.keepr-staging.digital` in Staging, each Installation in its Environment's account, and on loopback locally. Each Installation keeps to its own Keepr domain, `keepr.digital` or `keepr-staging.digital`: its cookie, its Return Addresses and its email. Served on neither, it keeps to `keepr.digital`'s Return Addresses and sender. (ADR-0122, #1255)

## User

- Nobody signs themselves up. A User is created by Keepr Accounts itself. (ADR-0112)
- A User always has a name. No path creates a User with a blank one, or saves one: a name that is empty once trimmed, or is not text, is refused 400 `NAME_REQUIRED`, and the page says so where it was typed. A name is kept trimmed. The rule is held where the library writes a User, so its own routes are bound by it as Keepr Accounts' are. Nothing rewrites a name saved before this rule: one the library's `/update-user` saved blank stands until its User enters a name. (#1354)
- A disabled User cannot sign in, and is told the account has been disabled and to ask a Keepr Administrator. (ADR-0112)
- Repeated sign-ins from one client are refused: a fourth within ten seconds answers 429 with a retry delay, the right password included. The count is kept in the database, keyed on the address Cloudflare vouches for (`cf-connecting-ip`), and is off only under `nuxt dev`. (ADR-0012, ADR-0112)
- The library's administrator routes answer 404 to every request, a Keepr Administrator's included. (ADR-0112)

## Session

- A Session lasts seven days from its last renewal. A request a day or more after the last renewal renews it. (ADR-0112)
- Signing out ends the Session at once: no cached copy of it is kept in a cookie. (ADR-0112)
- The session cookie is `HttpOnly`, `SameSite=Lax` and `Path=/`, and `Secure` with the `__Secure-` prefix on every server but `nuxt dev`. Served on a Keepr host it is set on that host's Keepr domain, `keepr.digital` or `keepr-staging.digital`, so every App of that Installation's Environment carries it; served anywhere else it is host-only. (ADR-0012, ADR-0112)
- A write to Better Auth's routes is admitted only from a page of Keepr Accounts itself: another origin, an App's included, is refused 403. (ADR-0112)
- A Session records the client address Cloudflare vouches for, never a forwarded one the caller wrote. (ADR-0012)

- A User's own Sessions are listed on the profile with no recent sign-in asked: the library's freshness check is off, and how recent a sign-in a sensitive action needs is Keepr Accounts' own check. A User ends any of their Sessions there; another User's they cannot. (#1228 § Sessions and cookies)

## Password

- A new password has 8 to 128 characters and is not known from a breach, on every path that sets one: a password reset and a change on the profile. While the breach check cannot be made, no new password is set: the request answers 500. (#1228 § Passwords)
- A User asks for a password reset at `/forgot-password`. A request for an address with no User answers exactly as one for a real User's, and emails nobody. (#1228 § Email)
- The reset link emailed opens `/reset-password`, its token in the fragment so no request carries it. It works once, for an hour, and setting a password with it ends every Session the User has. (#1228 § Passwords)
- Changing the password on the profile asks for the current one, and ends the User's other Sessions. (#1228 § Passwords)

## Email

- Every email is from Keepr at its Installation's Keepr domain, `Keepr <accounts@keepr.digital>` in Production and `Keepr <accounts@keepr-staging.digital>` in Staging, sent through Cloudflare's email service bound as `EMAIL`, which may send as no other address. Without the binding a send fails, naming it. (#1228 § Email, #1255)
- Nothing local sends mail. The dev server writes each message to `apps/accounts/.data/email` and logs where; `wrangler dev` simulates the binding; tests record it. (#1228 § Email)
- No response waits for an email: the Worker sends it after answering, so how long a request takes does not tell whether an address has a User. (#1228 § Email)

## Return Address

- A User signs in at `/sign-in`, and is sent afterwards to the Return Address named by `?returnTo=` when it is accepted, and to Keepr Accounts' home otherwise, told that the address was outside Keepr. (ADR-0112)
- Accepted: a path of Keepr Accounts itself, or an https address on its Installation's Keepr domain or any host under it, carrying no credentials: Staging sends nobody to Production, nor Production to Staging. A loopback address is accepted only when Keepr Accounts is itself served from one. (ADR-0112)

## Identity Proof

- `GET /api/auth/token` answers an Identity Proof for the Session whose cookie it is sent, and 401 with none, an ended Session or a disabled User's. `GET /api/auth/jwks` publishes the keys it verifies against, to anyone. (ADR-0113)
- It is signed EdDSA and good for five minutes. Its issuer is `https://accounts.keepr.digital` and its audience `https://keepr.digital`, fixed and never read from a request. (ADR-0112, ADR-0113)
- It names the User (`sub`, `email`, `name`), the Session (`sid`), the active Organisation (`org`) and the User's Organisation role in it (`orgRole`), their App role in each App they have access to in that Organisation (`apps`), and whether they are a Keepr Administrator (`keeprAdmin`). (ADR-0113)
- A new Session works in the Organisation its User joined first, or in none. (ADR-0113)
- A disabled User's Session mints no Identity Proof, even while it is open. (ADR-0113)

## User names

- `GET /api/users/names?id=…&id=…` answers `{ names }`: the name of each User asked about, by id, who shares an Organisation with the User of the Session whose cookie it is sent, whichever of their Organisations that Session works in. An App asks it with the cookie of the request it is answering, as it asks for an Identity Proof. (ADR-0145)
- It answers a Session and nothing else: no App is answered for itself, and a request with no cookie, an ended Session or a disabled User's is refused 401 `SIGNED_OUT`, as no Identity Proof is minted. (ADR-0145)
- Only a name is answered: never an email, a role, an Organisation or whether a User is disabled. A disabled User who is still a member is named. (ADR-0145)
- An id no User has, a User who shares no Organisation with the asker and a User whose name is blank are left out alike, and nothing in the answer tells one from another. It lists nobody: a User is learnt of only by an id already held. (ADR-0145)
- A Keepr Administrator is answered as anyone is: only those they share an Organisation with. They find any User at `/platform`. (ADR-0117, ADR-0145)
- One question asks about at most 50 Users: more is refused 400 `TOO_MANY_USER_IDS`, and none answers no names. (ADR-0145)
- It renews no Session. (ADR-0145)

## Organisation

- An Organisation role governs only the Organisation's membership: owners and admins invite, a member cannot, and only an owner invites an owner. A User cannot create an Organisation: Keepr Accounts creates one on purpose, the Keepr Organisation with the first Keepr Administrator, and any other at a Keepr Administrator's request. The library's `/organization/create` is refused 403 to everyone, a Keepr Administrator included. (ADR-0114, ADR-0115, ADR-0117)
- Nothing renames or deletes an Organisation: the library's `/organization/update` and `/organization/delete` answer 404 to every request. (ADR-0117)
- A User is a member of an Organisation once, or not: two accepts made at once leave one membership. (ADR-0155)
- A member holds one App role, or none, in each App: App access, one row per member and App, naming an App and a role from the App registry. (ADR-0114)
- An Organisation admits 10,000 members and 10,000 pending Invitations: a further Invitation is refused 403 `INVITATION_LIMIT_REACHED`. (ADR-0114)
- No two Organisations share a name: names are compared by their slug, their letters and digits hyphenated, so `The Club` and `the-club` are one. (ADR-0117)

## Invitation

- An owner or admin, or a Keepr Administrator, invites an address at `/invite` to the Organisation they are working in, or the one `?organisation=` names, with an Organisation role and an App role per App, through Keepr Accounts' own route. The member screen links to it for its Organisation. Only an owner or a Keepr Administrator invites an owner: an admin is refused 403 `OWNER_REQUIRED`; anyone who does not manage the Organisation's members 403 `NOT_A_MANAGER`. (ADR-0114, ADR-0116)
- Refused, no Invitation is made and nothing is emailed: App roles the App registry does not name 400 `APP_ROLE_NOT_IN_REGISTRY`; an address that is not one plausible mailbox, `local@domain.tld` with no list and no display name, 400 `INVALID_EMAIL` (`a@b` and `a,b@c.example` are refused); an Organisation role there is none of 400 `ORGANISATION_ROLE_NOT_KNOWN`; an address already a member 409 `ALREADY_A_MEMBER`. (ADR-0114, ADR-0155)
- Inviting needs a sign-in no older than ten minutes, as a change to a member does: older, it is refused 403 `RECENT_SIGN_IN_REQUIRED` and the page asks for a new one. Cancelling needs none. (ADR-0155)
- One inviter makes at most 50 Invitations to an Organisation in an hour, whatever became of them: the next is refused 429 `TOO_MANY_INVITATIONS`. (ADR-0155)
- An Invitation lasts seven days. It is emailed to the address, naming who invited them and to which Organisation, with a link to `/invitation` carrying its id and a secret in the fragment. An email that fails to send leaves the Invitation standing. (ADR-0114, ADR-0155)
- The secret is the invitee's alone: it is in the email and nowhere else. It is stored only as its SHA-256 digest, and is in no answer to the inviter, no listing a manager or the invitee's other Sessions can read, and no row of the Audit Record. Inviting the address again is how a lost email is replaced. (ADR-0155)
- Reading the offer, accepting as a new User, accepting as an existing User and declining each need the secret. An id with no secret, or with one not its own, is answered as no Invitation, 404 `INVITATION_NOT_FOUND`, whatever its state. (ADR-0155)
- The invitee sees who invited them, to which Organisation, and the roles offered, before accepting. (ADR-0114)
- An invitee with no User accepts by choosing a name, which is not blank, and a password of 8 to 128 characters in no breach. Keepr Accounts creates exactly one User, its email verified, signs them in, makes them a member with the Organisation role offered, and gives them App access in each App the Invitation named. An address that already has a User is told to sign in to accept. (ADR-0114)
- Accepting copies the Invitation's App roles into App access, whoever accepts. (ADR-0114)
- An invitee who has a User signs in with the invited address, through `/sign-in` and back to the Invitation, and accepts through Keepr Accounts' own route: the Organisation and its App access are added to their User, and their Session works in it. Signed in with any other address, accepting is refused 403 and nothing changes. (ADR-0114, ADR-0155)
- The invitee may decline from the Invitation's link, signed in or not: the link's secret proves the address, as it does for accepting. A decline another origin's page made the browser send is refused 403 `CROSS_SITE_REQUEST`, and the Invitation stays open. (#1228 § Invitations, ADR-0010)
- An Invitation that is not open says why, answering 410 with `INVITATION_EXPIRED`, `INVITATION_CANCELLED`, `INVITATION_ACCEPTED` or `INVITATION_DECLINED`; an id no Invitation has answers 404 `INVITATION_NOT_FOUND`. A replaced Invitation reads as cancelled. (#1228 § Invitations)
- Those who manage an Organisation's members see its pending, unexpired Invitations at `/invite`, soonest to lapse first, and cancel one. One whose stored App roles cannot be read is listed offering none, and the rest as they are. An admin is not shown an offer to an owner, and cancelling one is refused 403 `OWNER_REQUIRED`; anyone else is refused 403 `NOT_A_MANAGER`. Only a pending Invitation is cancelled: any other answers 400 `INVITATION_NOT_PENDING`, and one the Organisation does not have 404 `INVITATION_NOT_FOUND`. (ADR-0114, ADR-0116)
- The library's `/organization/invite-member`, `/organization/list-invitations` and `/organization/cancel-invitation` answer 404 to every request. (ADR-0116) So do `/organization/get-invitation`, `/organization/list-user-invitations`, `/organization/accept-invitation` and `/organization/reject-invitation`. The library sends no Invitation email. (ADR-0155)
- Inviting an address that has a pending Invitation to the Organisation cancels it, and the new one alone stands. An admin who invites an address holding a pending, unexpired offer to be an owner is refused 403 `OWNER_REQUIRED`, and the owner's offer stands. (ADR-0114, ADR-0155)
- An Invitation stands no longer than its inviter's standing: removing a member cancels the Invitations they offered to that Organisation that are still open, and disabling a User those they offered to any. (ADR-0155)
- An Invitation open before its link carried a secret was cancelled when the change was deployed; its invitee is invited again. (ADR-0155)

## Profile

- A User changes their own name on the profile. A blank one is refused, and they keep the name they had. (#1354)
- The profile lists the User's Organisations, in the order they joined, with their Organisation role and their App role in each App they can use there. (#1228 § The model)
- A User in more than one Organisation switches the one they work in on the profile. It is carried on the Session, so every App's next Identity Proof names it, with their roles there. Switching to an Organisation they do not belong to is refused 403. A User in exactly one is shown no switcher. (ADR-0113)

## Members

- An owner or admin of an Organisation lists its members at `/members`, each with their Organisation role and App roles, for the Organisation they are working in, or the one `?organisation=` names; a Keepr Administrator manages any Organisation as its owner would. The profile links each Organisation a User manages to its member screen, and the one they work in to `/invite`. Anyone else is refused 403 `NOT_A_MANAGER`, and finds the member and Invitation screens closed. (ADR-0116)
- They give a member an App role in one App, or take that App's access away while the member stays; an App or role the App registry does not name is refused 400 `APP_ROLE_NOT_IN_REGISTRY`. They remove a member, with all their App access and the Invitations they offered there that are still open. A member named under an Organisation they are not a member of is refused 404 `MEMBER_NOT_FOUND`, whoever asks. (ADR-0114, ADR-0116, ADR-0155)
- A removed member's Session stays open, but its next Identity Proof names no Organisation and no App access of the one they left. (ADR-0113)
- Only an owner, or a Keepr Administrator, changes a member's Organisation role or removes an owner: an admin is refused 403 `OWNER_REQUIRED`. The last owner is never demoted or removed: 409 `LAST_OWNER`. (ADR-0116)
- Each change needs a sign-in no older than ten minutes, counted from the Session's sign-in, which renewing it does not move. An older one is refused 403 `RECENT_SIGN_IN_REQUIRED` and asked to sign in again. Listing needs none. (ADR-0116)
- The library's `/organization/update-member-role` and `/organization/remove-member` answer 404 to every request. (ADR-0116)
- A member without administrative rights sees nobody else's access: the library's `/organization/list-members` and `/organization/get-full-organization`, which would answer every member's email and roles, answer 404 to every request. What a member learns of another is their name, by an id they already hold (User names). (#1228 story 40, ADR-0145)
- Nobody leaves an Organisation of their own accord: the library's `/organization/leave` answers 404 to every request, and a member goes only by being removed, which is audited and never takes the last owner. (#1228 § Administration and audit)
- A write to Keepr Accounts' own routes that needs a Session is refused 403 when another origin's page made the browser send it, as Stream Keepr's API boundary refuses one (ADR-0010, ADR-0116).

## Keepr Administrator

- A Keepr Administrator runs the platform at `/platform`, linked from their profile, through Keepr Accounts' own routes under `/api/platform`. Anyone else is refused 403 `NOT_A_KEEPR_ADMINISTRATOR`, and finds the screen closed. (ADR-0117)
- They list every Organisation, with how many members each has, and open any one's member screen. (ADR-0116, ADR-0117)
- They create an Organisation by naming it and its first owner's address, with an App role per App for them. Keepr Accounts invites that address as the Organisation's owner, emailed as any Invitation is, its link shown to nobody else; the Keepr Administrator becomes no member of it, and it has none until the invitee accepts. A name another Organisation has is refused 409 `ORGANISATION_EXISTS`; a blank name 400 `NAME_REQUIRED`; an address that is none 400 `INVALID_EMAIL`; an App role the App registry does not name 400 `APP_ROLE_NOT_IN_REGISTRY`. Refused, nothing is created, invited or emailed. (ADR-0114, ADR-0117)
- They find any User whose name or email contains what they type, ignoring case, each shown with whether they are disabled or a Keepr Administrator; at most 50 at once. (ADR-0117)
- They disable a User, which ends every Session that User has at once and cancels the Invitations they offered that are still open, and enable them again. A Keepr Administrator cannot disable themselves: 409 `CANNOT_DISABLE_SELF`. An id no User has answers 404 `USER_NOT_FOUND`. (ADR-0113, ADR-0117)
- Creating an Organisation, disabling a User and enabling one need a sign-in no older than ten minutes, as a change to a member does: older, it is refused 403 `RECENT_SIGN_IN_REQUIRED` and changes nothing. Listing, finding and reading need none. (ADR-0116, ADR-0117)
- They read the Audit Record's latest 200 rows, newest first, each naming who acted, on whom and in which Organisation. (ADR-0117)
- Being a Keepr Administrator grants no App access, and no Organisation role, by itself: their Identity Proof names only the Organisations they joined. (ADR-0117)

## First Administrator Claim

- No request creates a Keepr Administrator. `pnpm claim-first-administrator <email>` writes a First Administrator Claim, and prints the link that claims it, only while no Keepr Administrator exists. (ADR-0115)
- The claim page, `/first-administrator`, works once, and only while no Keepr Administrator exists. Claiming creates the address's User as a Keepr Administrator, email verified, with the name chosen, which is not blank, and the password chosen under the same rules as any new password; creates the Keepr Organisation with them as its owner; consumes the claim; and signs them in. A refused name or password leaves the claim to try again. (ADR-0115, #1354)

## Audit Record

- Each of these is a row, with who acted and when, the Organisation and the User it touched where there is one: a First Administrator Claim made (by the command, naming the operator's login) and consumed, an Organisation created, an Invitation created and accepted. (ADR-0114, ADR-0115)
- An Invitation created is a row with what it offers and whether an owner, an admin or a Keepr Administrator made it, never its secret. Every cancellation is a row naming who cancelled it and as what; one replaced by inviting the address again names the inviter and the Invitation that replaced it; one cancelled with its inviter says why (`inviter-removed`, `inviter-disabled`); one cancelled for having no secret names nobody (`no-secret`). An Invitation declined is a row naming the invitee's User when the address has one. (ADR-0114, ADR-0116)
- So is each change to a member: an App role set or removed, an Organisation role changed, a member removed; with what they had before and whether an owner, an admin or a Keepr Administrator made it. (ADR-0116)
- So is each Keepr Administrator's action: an Organisation created, with its first owner's Invitation; a User disabled; the Sessions disabling them ended, a row of its own (`user.sessions-ended`) with how many; a User enabled. (ADR-0117)
