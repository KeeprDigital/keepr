# @keepr/accounts-stand-in

The Accounts Stand-in (root `GLOSSARY.md`, ADR-0113): a Worker registered locally under Keepr Accounts' service name, `keepr-accounts`, that answers every App's request as the Local Developer User with full authority. It is how local work needs no sign-in, with no switch in any shipped build. **It is never deployed.**

| Path | What |
|---|---|
| `src/standIn.ts` | The answers: an Identity Proof at `/api/auth/token`, its key at `/api/auth/jwks`, and 404 for anything else. |
| `src/worker.ts` | The same, as a Worker. |
| `stand-in.wrangler.jsonc` | Its Wrangler configuration, under a name Wrangler does not find by itself. |
| `scripts/stand-in.mjs` | `keepr-accounts-stand-in [-- <command>]`: starts it under `wrangler dev`, beside the command, and stops it when the command ends. |

## What it answers

The Local Developer User (`local-developer`), a Keepr Administrator, owner of the Keepr Organisation `keepr-local` (the same id every run), with the highest App role in every App the App registry names. It signs with the production issuer and audience and a key it makes on its first request, so an App verifies it with the code it runs in production, and nothing it signs verifies against Keepr Accounts' keys.

## Running it

```
keepr-accounts-stand-in -- nuxt dev    # an App's dev script: the stand-in beside the App
pnpm accounts:stand-in                 # from the root: the stand-in alone
KEEPR_ACCOUNTS_STAND_IN=off …          # the command alone, with the real Keepr Accounts beside it (apps/accounts/README.md)
```

An App's binding finds it through Wrangler's local dev registry, and reconnects when it restarts. With nothing registered, an App refuses with a 503 that says so.

## Never deployed

There is no deploy script. `package.json` carries `keepr.undeployable`, and `keepr-deploy-guard` (`@keepr/tooling`), which every deploy runs on the configuration it uploads, refuses it. Deployed under `keepr-accounts`, it would replace Keepr Accounts and sign anyone in.

## Commands

```
pnpm typecheck
pnpm test        # its answers, read by the layer's own identity function
```
