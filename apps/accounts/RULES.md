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

## Return Address

- A User signs in at `/sign-in`, and is sent afterwards to the Return Address named by `?returnTo=` when it is accepted, and to Keepr Accounts' home otherwise, told that the address was outside Keepr. (ADR-0112)
- Accepted: a path of Keepr Accounts itself, or an https address on `keepr.digital` or any host under it, carrying no credentials. A loopback address is accepted only when Keepr Accounts is itself served from one. (ADR-0112)

## Identity Proof

- The signed-token routes answer 404 until the Identity Proof is built on them. Its issuer is `https://accounts.keepr.digital` and its audience `https://keepr.digital`, fixed and never read from a request. (ADR-0112)
