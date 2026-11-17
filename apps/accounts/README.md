# Keepr Accounts

One Keepr identity: every User, Session, Organisation and App access, and the service that vouches for them to each App (ADR-0112, in the root `docs/adr`). A Nuxt app (`@keepr/accounts`) on the workspace's shared layer, built as the Worker `keepr-accounts` for `accounts.keepr.digital`. Nothing deploys it yet.

Its words are the root `GLOSSARY.md`'s; `RULES.md` says what it makes true. The work that builds it is #1228.

## Layout

| Path | What |
|---|---|
| `server/utils/authOptions.ts` | Better Auth as Keepr Accounts configures it, less the database and the secret. Tests build from the same function. |
| `server/utils/auth.ts` | The instance a request is answered by, one per cookie domain. |
| `server/utils/identityProof.ts` | What an Identity Proof names, read from the identity database, and the Organisation a new Session works in. |
| `server/api/auth/[...all].ts` | Better Auth's routes under `/api/auth`. |
| `server/db/schema.ts` | The identity schema, by hand; `server/db/migrations/sqlite` its migrations. |
| `server/email` | The email seam (`sender.ts`): Cloudflare's email service (`cloudflare.ts`), the recorder tests and the dev server use instead (`recorder.ts`), and what each email says (`messages.ts`). |
| `server/utils/email.ts` | Which sender a running server uses, and the work it finishes after answering. |
| `server/utils/organisations.ts` | What Keepr Accounts adds to the organisation add-on: the Invitation email, App roles checked against the App registry and copied into App access (`appAccess.ts`), and the Audit Record (`auditRecord.ts`). |
| `server/utils/invitationAcceptance.ts` | An invitee with no User accepting: the offer they see, and creating their User. Served by `server/api/invitation`. |
| `server/utils/firstAdministrator.ts` | Claiming the first Keepr Administrator. Served by `server/api/first-administrator`; the claim is written by `scripts/claim-first-administrator.mjs`. |
| `server/utils/refusal.ts` | How Keepr Accounts' own routes refuse, in the shape Better Auth's do. |
| `shared/utils/returnAddress.ts` | Where a User may be sent after signing in. |
| `shared/utils/newPassword.ts` | The length a new password must be, and what a refused one is told. |
| `app/pages` | Signing in (`/sign-in?returnTo=…`), the profile (`/`), resetting a password (`/forgot-password`, then the emailed link to `/reset-password`), inviting (`/invite`), accepting an Invitation (`/invitation`), and claiming the first Keepr Administrator (`/first-administrator`). |
| `test/unit` | The server, request in and response out, on SQLite with the real migrations (`test/helpers/keeprAccounts.ts`). Also the shared layer's identity function against this real minting (`requestIdentity.sqlite.test.ts`), since the layer cannot import an app. |
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
pnpm beside       # the built Worker, registered locally as keepr-accounts: see below
```

Nothing local sends mail. The dev server writes each email, a reset link among them, to `.data/email/` here and logs the file; a local run of the built Worker (`wrangler dev`) simulates Cloudflare's email service and logs where it wrote each one.

## Running it beside an App

An App binds `keepr-accounts` (`packages/nuxt-layer/README.md`), and locally the Accounts Stand-in answers it as the Local Developer User. To sign in for real instead, or to see an App as someone with less than full authority (ADR-0113):

1. Here, with the secret set in `.env`: `pnpm beside`. It builds Keepr Accounts, applies the migrations to the same local database `pnpm dev` uses, and serves the built Worker at `http://localhost:8790`, registered locally as `keepr-accounts`.
2. In the App: `KEEPR_ACCOUNTS_STAND_IN=off NUXT_PUBLIC_KEEPR_ACCOUNTS_ORIGIN=http://localhost:8790 pnpm dev`. The App's binding now reaches this Keepr Accounts, with no change to its configuration, and a signed-out visitor is sent here to sign in.
3. Open the App at `http://localhost:…`, not `127.0.0.1`: the session cookie is host-only on `localhost`, and a browser sends it to every port of the same host.

Only the built Worker registers in Wrangler's local dev registry; `pnpm dev` here does not, so an App cannot reach it.

## The first Keepr Administrator

Nobody can sign up, and no request makes a Keepr Administrator (ADR-0115). Once the migrations are applied, in this directory:

```
pnpm claim-first-administrator you@example.com                       # the local database
pnpm claim-first-administrator you@example.com --remote <database>   # a deployed one, with your Cloudflare access
```

It writes a one-time claim for the address and prints the link that claims it: open it, choose a name and password, and you are the Keepr Administrator and owner of the Keepr Organisation. The local link is the dev server's (`http://localhost:3000`); under `pnpm beside`, use port 8790. Once a Keepr Administrator exists, the command writes nothing. Everyone else joins by Invitation, from `/invite`.

After a Better Auth bump, `test/unit/server/db/identitySchema.test.ts` fails if a table changed, and `authTripwires.sqlite.test.ts` if behaviour that depends on the environment did.
