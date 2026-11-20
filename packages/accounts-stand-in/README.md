# @keepr/accounts-stand-in

The Accounts Stand-in (root `GLOSSARY.md`, ADR-0113): a Worker registered locally under Keepr Accounts' service name, `keepr-accounts`, that answers every App's request as the Local Developer User with full authority. It is how local work needs no sign-in, with no switch in any shipped build. **It is never deployed.**

| Path | What |
|---|---|
| `src/standIn.ts` | The answers: an Identity Proof at `/api/auth/token`, its key at `/api/auth/jwks`, names at `/api/users/names`, and 404 for anything else. |
| `src/cookie.mjs` | The `keepr-stand-in` cookie that names who it answers as: `@keepr/accounts-stand-in/cookie`, plain JavaScript a script or a test imports. |
| `src/worker.ts` | The same, as a Worker. |
| `stand-in.wrangler.jsonc` | Its Wrangler configuration, under a name Wrangler does not find by itself. |
| `scripts/stand-in.mjs` | `keepr-accounts-stand-in [-- <command>]`: starts it under `wrangler dev`, beside the command, and stops it when the command ends. |
| `scripts/registry.mjs` | Where a run registers it: the Wrangler registry it uses, and what it tells the command. |

## What it answers

The Local Developer User (`local-developer`), a Keepr Administrator, owner of the Keepr Organisation `keepr-local` (the same id every run), with the highest App role in every App the App registry names, in one Session (`local-developer-session`) whatever the browser. It signs with the production issuer and audience and a key it makes on its first request, so an App verifies it with the code it runs in production, and nothing it signs verifies against Keepr Accounts' keys.

### As someone else

An App forwards a request's cookies to Keepr Accounts, and the stand-in reads one of its own, `keepr-stand-in`, as Keepr Accounts reads a session cookie (ADR-0141, in `apps/stream/docs/adr`). With none, it answers as above. Its value is `signed-out`, or fields joined by `&`:

| Value | Answers as |
|---|---|
| `signed-out` | Nobody: 401, as Keepr Accounts answers a request with no Session. |
| `user=<id>` | Another User. Their Session is `<id>-session`, their name `<id>` and their email `<id>@keepr.invalid`, unless named. |
| `name=<name>` | That User, called `<name>`. |
| `session=<id>` | Another Session of the User: a second signed-in browser. |
| `<app>=<role>` | That App role in the App, such as `stream=member`. An App left out keeps its highest role. |
| `<app>=none` | No App access to the App. |

A test of a whole server builds the header with `standInCookie` from `@keepr/accounts-stand-in/cookie`:

```ts
import { standInCookie } from '@keepr/accounts-stand-in/cookie';

standInCookie('signed-out'); // keepr-stand-in=signed-out
standInCookie({ user: 'ada', apps: { stream: 'member' } }); // keepr-stand-in=user=ada&stream=member
standInCookie({ apps: { stream: null } }); // keepr-stand-in=stream=none
```

A browser is given it by hand, in its console: `document.cookie = 'keepr-stand-in=session=second'` makes that browser a second Session of the Local Developer User, which is how two local browsers are two editors.

The cookie adds no authority. The stand-in already answers anyone who reaches it as a User with full authority; the cookie can only ask for less, or for another name. Every refusal that follows is the App's own.

### What it calls other Users

An App asks Keepr Accounts what to call a User other than its reader, at `/api/users/names` (ADR-0145, in the root `docs/adr`). The stand-in holds no Users, so it names the Local Developer User and whoever it has answered as since it started, by the name it gave them last: a User exists locally once a request has named them. Everyone it answers as works in the one Organisation, so each is named to anyone signed in. An id it has not answered as, and a User given a blank name, come back unnamed, as an id no User has does from Keepr Accounts. It refuses as Keepr Accounts does: 401 to a signed-out visitor, 400 to a question about more than 50 ids.

To see another User's name in a local browser, act as them first (`document.cookie = 'keepr-stand-in=user=ada&name=Ada Lovelace'`), then clear the cookie and read as the Local Developer User. Restarting the stand-in forgets them.

## Running it

```
keepr-accounts-stand-in -- nuxt dev    # the stand-in beside a command, as an App's dev script runs it
pnpm accounts:stand-in                 # from the root: the stand-in alone
KEEPR_ACCOUNTS_STAND_IN=off …          # the command alone, with the real Keepr Accounts beside it (apps/accounts/README.md)
```

Stream Keepr runs its `dev` script, its preview and its Worker smoke run through `keepr-accounts-stand-in`, and its integration suite starts each of its servers through it (ADR-0113, ADR-0141). With nothing registered where an App looks, the App refuses with a 503 that says so.

### One registry for each run

An App's binding finds the stand-in through Wrangler's local registry: one directory, keyed by the Worker's name, and by default one for the whole machine. Wrangler keeps the first of two Workers registered under one name. So where the stand-in registers is decided for each run (`scripts/registry.mjs`):

- **Beside a command**, it makes a temporary registry of the run's own and sets `WRANGLER_REGISTRY_PATH` to it for the stand-in and the command, so every Worker the command starts, such as realtime's dev Worker (`packages/realtime/README.md`), registers there too. The command starts only once the stand-in is registered, so its first request is never refused for a Worker still starting. The registry is removed when the command ends. Two runs at once, in two worktrees or in one integration suite, never find each other's Workers.
- **Inside another run**, it starts no second stand-in. The outer run names its registry in `KEEPR_ACCOUNTS_STAND_IN_REGISTRY`; a run that would register in that same registry runs its command alone. So a script that starts the stand-in may itself be run through it, as the deploy tooling's build step runs `worker:smoke`.
- **With `WRANGLER_REGISTRY_PATH` already named**, it registers there and leaves the name as it was.
- **Alone**, with no registry named, it registers where Wrangler does by default, where an App started apart finds it.
- **Its local state is the run's own**, wherever it registers: what Wrangler writes for the stand-in goes to a temporary directory removed with the run, never to this package's `.wrangler`. Two stand-ins started from one checkout at once open no file in common; sharing one, `workerd` refuses to start on a locked file.
- **`KEEPR_ACCOUNTS_STAND_IN=off`** starts none and sets nothing. A dev server that keeps a registry of its own, as one with realtime's layer does, then finds Keepr Accounts only when both were started under one `WRANGLER_REGISTRY_PATH`: `WRANGLER_REGISTRY_PATH=<directory> pnpm beside` in `apps/accounts`, and `WRANGLER_REGISTRY_PATH=<directory> KEEPR_ACCOUNTS_STAND_IN=off NUXT_PUBLIC_KEEPR_ACCOUNTS_ORIGIN=http://localhost:8790 pnpm dev` in the App. Run one such App at a time in a registry: a second would register its realtime dev Worker under the first's name.

## Never deployed

There is no deploy script, and Wrangler does not find `stand-in.wrangler.jsonc` by itself. `package.json` carries `keepr.undeployable`, which `keepr-deploy-guard` (`@keepr/tooling`) refuses: reading a Release runs the guard on every configuration its descriptor names, and a deploy runs it again on what it is about to upload (ADR-0119). The deploy tooling starts the stand-in around a binding App's build, to answer its Worker smoke run; it uploads nothing of it. Deployed under `keepr-accounts`, the stand-in would replace Keepr Accounts and sign anyone in. So it also fails closed without any of that (ADR-0154): its configuration names an account no one holds, and its Worker refuses every request unless the launcher started it with `--var KEEPR_ACCOUNTS_STAND_IN:launched`.

## Commands

```
pnpm typecheck
pnpm test        # its answers, read by the layer's own identity function, and where a run registers it
```
