# Keepr Accounts rules

What Keepr Accounts makes true for a User, an operator and every App. Its words are the root `GLOSSARY.md`'s, under Identity and access; the reasons are in the decisions cited: ADR-0114 and ADR-0115 in this app's `docs/adr`, ADR-0012 in `apps/stream/docs/adr`, and the rest in the root `docs/adr`.

## Identity

- Keepr Accounts alone opens the identity database, holds the sign-in secret and runs Better Auth. No App binds the database. (ADR-0112)
- A blank `NUXT_BETTER_AUTH_SECRET` answers 503 naming it, and nobody can sign in. (ADR-0112)
- The identity schema is Better Auth's tables for its chosen add-ons, held to the library's own definitions by a test, plus App access, the Audit Record and the First Administrator Claim. The adapter runs without transactions. (ADR-0112)

## User

- Nobody signs themselves up. A User is created by Keepr Accounts itself. (ADR-0112)
- A disabled User cannot sign in, and is told the account has been disabled and to ask a Keepr Administrator. (ADR-0112)
- Repeated sign-ins from one client are refused: a fourth within ten seconds answers 429 with a retry delay, the right password included. The count is kept in the database, keyed on the address Cloudflare vouches for (`cf-connecting-ip`), and is off only under `nuxt dev`. (ADR-0012, ADR-0112)
- The library's administrator routes answer 404 to every request, a Keepr Administrator's included. (ADR-0112)

## Session

- A Session lasts seven days from its last renewal. A request a day or more after the last renewal renews it. (ADR-0112)
- Signing out ends the Session at once: no cached copy of it is kept in a cookie. (ADR-0112)
- The session cookie is `HttpOnly`, `SameSite=Lax` and `Path=/`, and `Secure` with the `__Secure-` prefix on every server but `nuxt dev`. Served on a Keepr host it is set on `keepr.digital`, so every App's requests carry it; served anywhere else it is host-only. (ADR-0012, ADR-0112)
- A write to Better Auth's routes is admitted only from a page of Keepr Accounts itself: another origin, an App's included, is refused 403. (ADR-0112)
- A Session records the client address Cloudflare vouches for, never a forwarded one the caller wrote. (ADR-0012)

- A User's own Sessions are listed on the profile with no recent sign-in asked: the library's freshness check is off, and how recent a sign-in a sensitive action needs is Keepr Accounts' own check. A User ends any of their Sessions there; another User's they cannot. (#1228 § Sessions and cookies)

## Password

- A new password has 8 to 128 characters and is not known from a breach, on every path that sets one: a password reset and a change on the profile. While the breach check cannot be made, no new password is set: the request answers 500. (#1228 § Passwords)
- A User asks for a password reset at `/forgot-password`. A request for an address with no User answers exactly as one for a real User's, and emails nobody. (#1228 § Email)
- The reset link emailed opens `/reset-password`, its token in the fragment so no request carries it. It works once, for an hour, and setting a password with it ends every Session the User has. (#1228 § Passwords)
- Changing the password on the profile asks for the current one, and ends the User's other Sessions. (#1228 § Passwords)

## Email

- Every email is from `Keepr <accounts@keepr.digital>`, sent through Cloudflare's email service bound as `EMAIL`, which may send as no other address. Without the binding a send fails, naming it. (#1228 § Email)
- Nothing local sends mail. The dev server writes each message to `apps/accounts/.data/email` and logs where; `wrangler dev` simulates the binding; tests record it. (#1228 § Email)
- No response waits for an email: the Worker sends it after answering, so how long a request takes does not tell whether an address has a User. (#1228 § Email)

## Return Address

- A User signs in at `/sign-in`, and is sent afterwards to the Return Address named by `?returnTo=` when it is accepted, and to Keepr Accounts' home otherwise, told that the address was outside Keepr. (ADR-0112)
- Accepted: a path of Keepr Accounts itself, or an https address on `keepr.digital` or any host under it, carrying no credentials. A loopback address is accepted only when Keepr Accounts is itself served from one. (ADR-0112)

## Identity Proof

- `GET /api/auth/token` answers an Identity Proof for the Session whose cookie it is sent, and 401 with none, an ended Session or a disabled User's. `GET /api/auth/jwks` publishes the keys it verifies against, to anyone. (ADR-0113)
- It is signed EdDSA and good for five minutes. Its issuer is `https://accounts.keepr.digital` and its audience `https://keepr.digital`, fixed and never read from a request. (ADR-0112, ADR-0113)
- It names the User (`sub`, `email`, `name`), the Session (`sid`), the active Organisation (`org`) and the User's Organisation role in it (`orgRole`), their App role in each App they have access to in that Organisation (`apps`), and whether they are a Keepr Administrator (`keeprAdmin`). (ADR-0113)
- A new Session works in the Organisation its User joined first, or in none. (ADR-0113)
- A disabled User's Session mints no Identity Proof, even while it is open. (ADR-0113)

## Organisation

- An Organisation role governs only the Organisation's membership: owners and admins invite, a member cannot, and only an owner invites an owner. A User cannot create an Organisation: Keepr Accounts creates one on purpose, the Keepr Organisation with the first Keepr Administrator. (ADR-0114, ADR-0115)
- A member holds one App role, or none, in each App: App access, one row per member and App, naming an App and a role from the App registry. (ADR-0114)
- An Organisation admits 10,000 members and 10,000 pending Invitations. (ADR-0114)

## Invitation

- An owner or admin invites an address at `/invite` to the Organisation they are working in, with an Organisation role and an App role per App. App roles the App registry does not name are refused 400 `APP_ROLE_NOT_IN_REGISTRY`, and no Invitation is made. (ADR-0114)
- An Invitation lasts seven days. It is emailed to the address, naming who invited them and to which Organisation, with a link to `/invitation`, its id in the fragment. The inviter is shown the same link to copy; an email that fails to send leaves the Invitation standing. (ADR-0114)
- The invitee sees who invited them, to which Organisation, and the roles offered, before accepting. (ADR-0114)
- An invitee with no User accepts by choosing a name and a password of 8 to 128 characters in no breach. Keepr Accounts creates exactly one User, its email verified, signs them in, makes them a member with the Organisation role offered, and gives them App access in each App the Invitation named. An address that already has a User is told to sign in to accept. (ADR-0114)
- Accepting copies the Invitation's App roles into App access, whoever accepts. (ADR-0114)

## First Administrator Claim

- No request creates a Keepr Administrator. `pnpm claim-first-administrator <email>` writes a First Administrator Claim, and prints the link that claims it, only while no Keepr Administrator exists. (ADR-0115)
- The claim page, `/first-administrator`, works once, and only while no Keepr Administrator exists. Claiming creates the address's User as a Keepr Administrator, email verified, with the name and password chosen under the same rules as any new password; creates the Keepr Organisation with them as its owner; consumes the claim; and signs them in. A refused password leaves the claim to try again. (ADR-0115)

## Audit Record

- Each of these is a row, with who acted and when, the Organisation and the User it touched where there is one: a First Administrator Claim made (by the command, naming the operator's login) and consumed, an Organisation created, an Invitation created and accepted. (ADR-0114, ADR-0115)
