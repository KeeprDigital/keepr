# Keepr Accounts rules

What Keepr Accounts makes true for a User, an operator and every App. Its words are the root `GLOSSARY.md`'s, under Identity and access, and its own `GLOSSARY.md`'s; the reasons are in the decisions cited: ADR-0114 to ADR-0117 in this app's `docs/adr`, ADR-0010 and ADR-0012 in `apps/stream/docs/adr`, and the rest in the root `docs/adr`.

## Identity

- Keepr Accounts alone opens the identity database, holds the sign-in secret and runs Better Auth. No App binds the database. (ADR-0112)
- A blank `NUXT_BETTER_AUTH_SECRET` answers 503 naming it, and nobody can sign in. (ADR-0112)
- The identity schema is Better Auth's tables for its chosen add-ons, held to the library's own definitions by a test, plus App access, the Audit Record and the First Administrator Claim. The adapter runs without transactions. (ADR-0112)
- Keepr Accounts answers on `accounts.keepr.digital` in Production and `accounts.keepr-staging.digital` in Staging, each Installation in its Environment's account, and on loopback locally. Each Installation keeps to its own Keepr domain, `keepr.digital` or `keepr-staging.digital`: its cookie, its Return Addresses and its email. Served on neither, it keeps to `keepr.digital`'s Return Addresses and sender. (ADR-0122, #1255)

## User

- Nobody signs themselves up. A User is created by Keepr Accounts itself. (ADR-0112)
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

## Organisation

- An Organisation role governs only the Organisation's membership: owners and admins invite, a member cannot, and only an owner invites an owner. A User cannot create an Organisation: Keepr Accounts creates one on purpose, the Keepr Organisation with the first Keepr Administrator, and any other at a Keepr Administrator's request. The library's `/organization/create` is refused 403 to everyone, a Keepr Administrator included. (ADR-0114, ADR-0115, ADR-0117)
- Nothing renames or deletes an Organisation: the library's `/organization/update` and `/organization/delete` answer 404 to every request. (ADR-0117)
- A member holds one App role, or none, in each App: App access, one row per member and App, naming an App and a role from the App registry. (ADR-0114)
- An Organisation admits 10,000 members and 10,000 pending Invitations: a further Invitation is refused 403 `INVITATION_LIMIT_REACHED`. (ADR-0114)
- No two Organisations share a name: names are compared by their slug, their letters and digits hyphenated, so `The Club` and `the-club` are one. (ADR-0117)

## Invitation

- An owner or admin, or a Keepr Administrator, invites an address at `/invite` to the Organisation they are working in, or the one `?organisation=` names, with an Organisation role and an App role per App, through Keepr Accounts' own route. The member screen links to it for its Organisation. Only an owner or a Keepr Administrator invites an owner: an admin is refused 403 `OWNER_REQUIRED`; anyone who does not manage the Organisation's members 403 `NOT_A_MANAGER`. (ADR-0114, ADR-0116)
- Refused, no Invitation is made and nothing is emailed: App roles the App registry does not name 400 `APP_ROLE_NOT_IN_REGISTRY`; an address that is none 400 `INVALID_EMAIL`; an Organisation role there is none of 400 `ORGANISATION_ROLE_NOT_KNOWN`; an address already a member 409 `ALREADY_A_MEMBER`. (ADR-0114)
- Inviting and cancelling need no recent sign-in. (#1228 § Sessions and cookies)
- An Invitation lasts seven days. It is emailed to the address, naming who invited them and to which Organisation, with a link to `/invitation`, its id in the fragment. The inviter is shown the same link to copy; an email that fails to send leaves the Invitation standing. (ADR-0114)
- The invitee sees who invited them, to which Organisation, and the roles offered, before accepting. (ADR-0114)
- An invitee with no User accepts by choosing a name and a password of 8 to 128 characters in no breach. Keepr Accounts creates exactly one User, its email verified, signs them in, makes them a member with the Organisation role offered, and gives them App access in each App the Invitation named. An address that already has a User is told to sign in to accept. (ADR-0114)
- Accepting copies the Invitation's App roles into App access, whoever accepts. (ADR-0114)
- An invitee who has a User signs in with the invited address, through `/sign-in` and back to the Invitation, and accepts: the Organisation and its App access are added to their User, and their Session works in it. Signed in with any other address, accepting is refused 403 and nothing changes. (ADR-0114)
- The invitee may decline from the Invitation's link, signed in or not: the link proves the address, as it does for accepting. A decline another origin's page made the browser send is refused 403 `CROSS_SITE_REQUEST`, and the Invitation stays open. (#1228 § Invitations, ADR-0010)
- An Invitation that is not open says why, answering 410 with `INVITATION_EXPIRED`, `INVITATION_CANCELLED`, `INVITATION_ACCEPTED` or `INVITATION_DECLINED`; an id no Invitation has answers 404 `INVITATION_NOT_FOUND`. A replaced Invitation reads as cancelled. (#1228 § Invitations)
- Those who manage an Organisation's members see its pending, unexpired Invitations at `/invite`, soonest to lapse first, and cancel one. An admin is not shown an offer to an owner, and cancelling one is refused 403 `OWNER_REQUIRED`; anyone else is refused 403 `NOT_A_MANAGER`. Only a pending Invitation is cancelled: any other answers 400 `INVITATION_NOT_PENDING`, and one the Organisation does not have 404 `INVITATION_NOT_FOUND`. (ADR-0114, ADR-0116)
- The library's `/organization/invite-member`, `/organization/list-invitations` and `/organization/cancel-invitation` answer 404 to every request. (ADR-0116)
- Inviting an address that has a pending Invitation to the Organisation cancels it, and the new one alone stands. (ADR-0114)

## Profile

- The profile lists the User's Organisations, in the order they joined, with their Organisation role and their App role in each App they can use there. (#1228 § The model)
- A User in more than one Organisation switches the one they work in on the profile. It is carried on the Session, so every App's next Identity Proof names it, with their roles there. Switching to an Organisation they do not belong to is refused 403. A User in exactly one is shown no switcher. (ADR-0113)

## Members

- An owner or admin of an Organisation lists its members at `/members`, each with their Organisation role and App roles, for the Organisation they are working in, or the one `?organisation=` names; a Keepr Administrator manages any Organisation as its owner would. The profile links each Organisation a User manages to its member screen, and the one they work in to `/invite`. Anyone else is refused 403 `NOT_A_MANAGER`, and finds the member and Invitation screens closed. (ADR-0116)
- They give a member an App role in one App, or take that App's access away while the member stays; an App or role the App registry does not name is refused 400 `APP_ROLE_NOT_IN_REGISTRY`. They remove a member, with all their App access. (ADR-0114, ADR-0116)
- Only an owner, or a Keepr Administrator, changes a member's Organisation role or removes an owner: an admin is refused 403 `OWNER_REQUIRED`. The last owner is never demoted or removed: 409 `LAST_OWNER`. (ADR-0116)
- Each change needs a sign-in no older than ten minutes, counted from the Session's sign-in, which renewing it does not move. An older one is refused 403 `RECENT_SIGN_IN_REQUIRED` and asked to sign in again. Listing needs none. (ADR-0116)
- The library's `/organization/update-member-role` and `/organization/remove-member` answer 404 to every request. (ADR-0116)
- A member without administrative rights sees nobody else's access: the library's `/organization/list-members` and `/organization/get-full-organization`, which would answer every member's email and roles, answer 404 to every request. (#1228 story 40)
- Nobody leaves an Organisation of their own accord: the library's `/organization/leave` answers 404 to every request, and a member goes only by being removed, which is audited and never takes the last owner. (#1228 § Administration and audit)
- A write to Keepr Accounts' own routes that needs a Session is refused 403 when another origin's page made the browser send it, as Stream Keepr's API boundary refuses one (ADR-0010, ADR-0116).

## Keepr Administrator

- A Keepr Administrator runs the platform at `/platform`, linked from their profile, through Keepr Accounts' own routes under `/api/platform`. Anyone else is refused 403 `NOT_A_KEEPR_ADMINISTRATOR`, and finds the screen closed. (ADR-0117)
- They list every Organisation, with how many members each has, and open any one's member screen. (ADR-0116, ADR-0117)
- They create an Organisation by naming it and its first owner's address, with an App role per App for them. Keepr Accounts invites that address as the Organisation's owner, emailed and shown to copy as any Invitation is; the Keepr Administrator becomes no member of it, and it has none until the invitee accepts. A name another Organisation has is refused 409 `ORGANISATION_EXISTS`; a blank name 400 `NAME_REQUIRED`; an address that is none 400 `INVALID_EMAIL`; an App role the App registry does not name 400 `APP_ROLE_NOT_IN_REGISTRY`. Refused, nothing is created, invited or emailed. (ADR-0114, ADR-0117)
- They find any User whose name or email contains what they type, ignoring case, each shown with whether they are disabled or a Keepr Administrator; at most 50 at once. (ADR-0117)
- They disable a User, which ends every Session that User has at once, and enable them again. A Keepr Administrator cannot disable themselves: 409 `CANNOT_DISABLE_SELF`. An id no User has answers 404 `USER_NOT_FOUND`. (ADR-0113, ADR-0117)
- Creating an Organisation, disabling a User and enabling one need a sign-in no older than ten minutes, as a change to a member does: older, it is refused 403 `RECENT_SIGN_IN_REQUIRED` and changes nothing. Listing, finding and reading need none. (ADR-0116, ADR-0117)
- They read the Audit Record's latest 200 rows, newest first, each naming who acted, on whom and in which Organisation. (ADR-0117)
- Being a Keepr Administrator grants no App access, and no Organisation role, by itself: their Identity Proof names only the Organisations they joined. (ADR-0117)

## First Administrator Claim

- No request creates a Keepr Administrator. `pnpm claim-first-administrator <email>` writes a First Administrator Claim, and prints the link that claims it, only while no Keepr Administrator exists. (ADR-0115)
- The claim page, `/first-administrator`, works once, and only while no Keepr Administrator exists. Claiming creates the address's User as a Keepr Administrator, email verified, with the name and password chosen under the same rules as any new password; creates the Keepr Organisation with them as its owner; consumes the claim; and signs them in. A refused password leaves the claim to try again. (ADR-0115)

## Audit Record

- Each of these is a row, with who acted and when, the Organisation and the User it touched where there is one: a First Administrator Claim made (by the command, naming the operator's login) and consumed, an Organisation created, an Invitation created and accepted. (ADR-0114, ADR-0115)
- An Invitation created is a row with what it offers and whether an owner, an admin or a Keepr Administrator made it. Every cancellation is a row naming who cancelled it and as what; one replaced by inviting the address again names the inviter and the Invitation that replaced it. An Invitation declined is a row naming the invitee's User when the address has one. (ADR-0114, ADR-0116)
- So is each change to a member: an App role set or removed, an Organisation role changed, a member removed; with what they had before and whether an owner, an admin or a Keepr Administrator made it. (ADR-0116)
- So is each Keepr Administrator's action: an Organisation created, with its first owner's Invitation; a User disabled; the Sessions disabling them ended, a row of its own (`user.sessions-ended`) with how many; a User enabled. (ADR-0117)
