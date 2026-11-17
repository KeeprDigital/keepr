# Keepr Accounts rules

What Keepr Accounts makes true for a User, an operator and every App. Its words are the root `GLOSSARY.md`'s, under Identity and access; the reasons are in the decisions cited, in the root `docs/adr`. ADR-0012 is in `apps/stream/docs/adr`, from the repository's root.

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

- The signed-token routes answer 404 until the Identity Proof is built on them. Its issuer is `https://accounts.keepr.digital` and its audience `https://keepr.digital`, fixed and never read from a request. (ADR-0112)
