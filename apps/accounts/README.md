# Keepr Accounts

One Keepr identity: every User, Session, Organisation and App access, and the service that vouches for them to each App (ADR-0112, in the root `docs/adr`). A Nuxt app (`@keepr/accounts`) on the workspace's shared layer, built as the Worker `keepr-accounts` for `accounts.keepr.digital`, and for `accounts.keepr-staging.digital` in Staging. It is released and deployed on its own ([Deploying](#deploying)).

Its words are the root `GLOSSARY.md`'s and its own `GLOSSARY.md`'s; `RULES.md` says what it makes true. The work that builds it is #1228.

## Layout

| Path | What |
|---|---|
| `server/utils/authOptions.ts` | Better Auth as Keepr Accounts configures it, less the database and the secret. Tests build from the same function. |
| `server/utils/auth.ts` | The instance a request is answered by, one per cookie domain. |
| `server/utils/identityProof.ts` | What an Identity Proof names, read from the identity database, and the Organisation a new Session works in. |
| `server/api/auth/[...all].ts` | Better Auth's routes under `/api/auth`. |
| `server/utils/userNames.ts` | Whose name a Session is told, by id: a User who shares an Organisation with its own. Served by `server/api/users/names.get.ts`, which an App asks with its request's cookie. |
| `server/db/schema.ts` | The identity schema, by hand; `server/db/migrations/sqlite` its migrations. |
| `server/email` | The email seam (`sender.ts`): Cloudflare's email service (`cloudflare.ts`), the recorder tests and the dev server use instead (`recorder.ts`), and what each email says (`messages.ts`). |
| `server/utils/email.ts` | Which sender a running server uses, and the work it finishes after answering. |
| `server/utils/organisations.ts` | What Keepr Accounts adds to the organisation add-on: the Invitation email, App roles checked against the App registry and copied into App access (`appAccess.ts`), and the Audit Record (`auditRecord.ts`). |
| `server/utils/invitationAcceptance.ts` | The invitee's side: the offer they see or why it is closed, accepting with no User yet, and declining. Served by `server/api/invitation`. |
| `server/utils/invitations.ts` | Inviting to an Organisation, and its pending Invitations to see and cancel, for whoever manages its members. Served by `server/api/organisations/[organisationId]/invitations`. |
| `server/utils/profileOrganisations.ts` | A User's Organisations and App access, and the one their Session works in. Served by `server/api/profile`. |
| `server/utils/firstAdministrator.ts` | Claiming the first Keepr Administrator. Served by `server/api/first-administrator`; the claim is written by `scripts/claim-first-administrator.mjs`. |
| `server/utils/refusal.ts` | How Keepr Accounts' own routes refuse, in the shape Better Auth's do; `textField.ts` reads a request body's text. |
| `server/utils/userName.ts` | A User always has a name: the rule, and the hooks that hold it wherever Better Auth writes a User. |
| `shared/utils/returnAddress.ts` | Where a User may be sent after signing in. |
| `shared/utils/keeprDomain.ts` | The Keepr domain of each Installation, `keepr.digital` or `keepr-staging.digital`, which its cookie, Return Addresses and sender keep to. |
| `deploy.jsonc`, `wrangler.jsonc` | The deploy descriptor (ADR-0119) and the Worker's configuration for each Environment: account, host, database, email. `wrangler.dev.jsonc` is the local one. |
| `scripts/worker-dry-run.mjs`, `scripts/worker-smoke.mjs` | The checks a deploy and CI's Worker leg run on the build: Wrangler's bundle for each Environment, then the built Worker on local workerd. |
| `shared/utils/newPassword.ts` | The length a new password must be. |
| `shared/utils/keeprAdministrator.ts` | Whether a User's role marks a Keepr Administrator; `server/utils/keeprAdministrator.ts` asks it of the database. |
| `app/utils/refusal.ts` | What a page tells its User about a refusal, a refused name's and a refused new password's among it. |
| `app/utils/appRoleChoices.ts` | The Organisation roles and each App's App roles, as a form offers them. |
| `app/pages` | Signing in (`/sign-in?returnTo=…`), the profile (`/`), resetting a password (`/forgot-password`, then the emailed link to `/reset-password`), inviting and the pending Invitations (`/invite`), accepting or declining an Invitation (`/invitation`), and claiming the first Keepr Administrator (`/first-administrator`). |
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
pnpm worker:dry-run && pnpm worker:smoke   # after a build: the checks a deploy and CI's Worker leg run
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
pnpm claim-first-administrator you@example.com                                           # the local database
pnpm claim-first-administrator you@example.com --remote accounts-identity                # Production's, with your Cloudflare access
pnpm claim-first-administrator you@example.com --remote accounts-identity --env staging  # Staging's
```

It writes a one-time claim for the address and prints the link that claims it: open it, choose a name and password, and you are the Keepr Administrator and owner of the Keepr Organisation. The local link is the dev server's (`http://localhost:3000`); under `pnpm beside`, use port 8790. A deployed database's link is its Installation's, from `deploy.jsonc`. Once a Keepr Administrator exists, the command writes nothing. Everyone else joins by Invitation, from `/invite`.

## Deploying

Keepr Accounts is a versioned, deployable app like Stream Keepr: Changesets releases it as `@keepr/accounts@<version>` (from `0.1.0`), with its own `CHANGELOG.md` here, and the deploy tooling deploys a Release from its descriptor, `deploy.jsonc` (ADR-0118, ADR-0119). How a Release reaches Staging and then Production, and how to deploy by hand, is `apps/stream/README.md` § Releases and § Deploy; every command there takes `--app accounts`. Here, `pnpm run deploy`, `pnpm deploy:verify` and `pnpm deploy:status` are Production's.

| Environment | Installation | Cloudflare account (`wrangler.jsonc`) | Database | Sender |
|---|---|---|---|---|
| Production | `https://accounts.keepr.digital` | `3ec389380c7b82e6a172e6f351d4aad9`, top level | `accounts-identity` | `accounts@keepr.digital` |
| Staging | `https://accounts.keepr-staging.digital` | `98e3d208fbb975ce573938b72ed9e7b8`, `env.staging` | `accounts-identity` | `accounts@keepr-staging.digital` |

Keepr Accounts deploys before any App that depends on it, and never falls below one; the tooling enforces it (ADR-0120, `apps/stream/README.md` § Deploy order). Its Identity Proof names the issuer `https://accounts.keepr.digital` in both Environments: it is fixed, and each Environment's Apps verify it against their own Keepr Accounts' keys.

### Standing up an Installation

A new Installation is provisioned in this order: its resources, its Worker's secret, then its first deploy (ADR-0128). Do each step once per Environment, Staging first, from this directory, signed in with `wrangler login` to an account holding both. Every command names its account through `wrangler.jsonc` (ADR-0130): add `--env staging` for Staging, and nothing for Production.

1. **Create the identity database.**

   ```
   pnpm exec wrangler d1 create accounts-identity --config wrangler.jsonc [--env staging]
   ```

   `wrangler.jsonc` holds a placeholder ID, `00000000-0000-0000-0000-000000000000`, in each Environment's `d1_databases` until then. Write the printed `database_id` in its place, at the top level for Production and in `env.staging` for Staging, and land it in a PR with a patch changeset for `@keepr/accounts`. A deploy reads the configuration of the Release it deploys, so land it before marking the Version PR that releases `0.1.0` ready, or the first Release carries the placeholder. A deploy of a Release with the placeholder stops before its first remote change, when it reads the database's recovery point. The deploy applies the migrations itself (`databases` in `deploy.jsonc`); none is applied by hand.

2. **Set the sign-in secret**, `NUXT_BETTER_AUTH_SECRET`, the one Worker secret `deploy.jsonc` requires: a deploy refuses an Installation without it, and a blank one answers 503. Each Environment has its own value, recorded in 1Password (`op://Keepr/accounts-<environment>/NUXT_BETTER_AUTH_SECRET`, ADR-0134). From the workspace root, generate it there and set it in one step:

   ```
   pnpm secrets:sync --app accounts --env staging --generate NUXT_BETTER_AUTH_SECRET
   ```

   (`--env production` for Production.) Never set it only on the Worker with `wrangler secret put`: a Worker's secret can never be read back.

   The Worker `keepr-accounts` does not exist before this: setting its secret creates it. Changing the value later signs every User out and makes the Identity Proof's stored keys unreadable, so it is never rotated casually.

3. **Set up the sending domain**, `keepr.digital` in the production account and `keepr-staging.digital` in the staging account. In the dashboard: **Compute** > **Email Service** > **Email Sending** > **Onboard Domain**, and choose the domain. Cloudflare adds its records to the `cf-bounce` subdomain (MX, SPF, DKIM) and a DMARC record only if the domain has none, so the domain's own mail is untouched. Sending to anyone but verified addresses needs the Workers Paid plan. Until the domain is onboarded, a send is refused and the Invitation stands: its inviter copies the link instead (`RULES.md` § Email).

   **Leave Email Routing off.** Never onboard the domain under **Email Routing**: it replaces the root MX records, and `keepr.digital`'s mail is on Google Workspace. Keepr Accounts sends and never receives.

4. **Deploy.** Merging the Version PR deploys every app it released to Staging, then to Production once approved (ADR-0125). To deploy one Release yourself, run the Deploy workflow with `releases` `accounts` (or `@keepr/accounts@<version>`), or locally `pnpm run deploy --app accounts --env staging`. Wrangler attaches the custom domain on that first deploy, since each domain's zone is in its Installation's account (ADR-0122). The deploy verifies that `/api/release` names the Release.

5. **Claim the first Keepr Administrator**, with the deployed database's command in [The first Keepr Administrator](#the-first-keepr-administrator), and open the link it prints. Then invite everyone else from `/invite`.

After a Better Auth bump, `test/unit/server/db/identitySchema.test.ts` fails if a table changed, and `authTripwires.sqlite.test.ts` if behaviour that depends on the environment did.
