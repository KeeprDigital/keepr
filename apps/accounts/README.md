# Keepr Accounts

One Keepr identity: every User, Session, Organisation and App access, and the service that vouches for them to each App (ADR-0112, in the root `docs/adr`). A Nuxt app (`@keepr/accounts`) on the workspace's shared layer, built as the Worker `keepr-accounts` for `accounts.keepr.digital`. Nothing deploys it yet.

Its words are the root `GLOSSARY.md`'s; `RULES.md` says what it makes true. The work that builds it is #1228.

## Layout

| Path | What |
|---|---|
| `server/utils/authOptions.ts` | Better Auth as Keepr Accounts configures it, less the database and the secret. Tests build from the same function. |
| `server/utils/auth.ts` | The instance a request is answered by, one per cookie domain. |
| `server/api/auth/[...all].ts` | Better Auth's routes under `/api/auth`. |
| `server/db/schema.ts` | The identity schema, by hand; `server/db/migrations/sqlite` its migrations. |
| `shared/utils/returnAddress.ts` | Where a User may be sent after signing in. |
| `app/pages` | Signing in (`/sign-in?returnTo=…`), and who is signed in (`/`). |
| `test/unit` | The server, request in and response out, on SQLite with the real migrations (`test/helpers/keeprAccounts.ts`). |
| `test/nuxt` | One wiring test per page. |

## Running it

Set the sign-in secret in `apps/accounts/.env` (`.env.example` names it), then, in this directory:

```
pnpm dev          # applies the migrations to the local database, then nuxt dev
pnpm typecheck
pnpm test         # the server's tests, then the pages'
pnpm build        # the Worker bundle
pnpm verify       # the three above, as CI's `Keepr Accounts` job runs them
pnpm db:generate  # after a change to server/db/schema.ts: the next migration
```

Nobody can sign up, so a local User is made the way Keepr Accounts makes one; until the first-administrator claim exists, that is a test's `createUser`.

After a Better Auth bump, `test/unit/server/db/identitySchema.test.ts` fails if a table changed, and `authTripwires.sqlite.test.ts` if behaviour that depends on the environment did.
