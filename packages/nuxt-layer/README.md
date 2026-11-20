# @keepr/nuxt-layer

The Nuxt layer every Keepr app extends (ADR-0093, in the root `docs/adr`).

```ts
export default defineNuxtConfig({
	extends: ['@keepr/nuxt-layer'],
});
```

## What it holds

| Path | Holds |
|---|---|
| `nuxt.config.ts` | The shell: client rendering, Nuxt UI, VueUse, the colour mode, strict TypeScript, the Cloudflare Workers target, and the release identity each build records (`build/releaseIdentity.ts`). |
| `server/utils` | Errors a route reports, D1 parameter helpers, the request-body ceiling, shared-secret checks, error-log fields, the server time reading, the release identity (`release.ts`), who a request belongs to (`requestIdentity.ts`), what to call another User (`userNames.ts`), the refusal of a cross-site write (`crossSiteMutation.ts`). Auto-imported by Nitro. |
| `shared/` | What the server and the client both read: the state-conflict code, the body-limit route rule's types, the server time and release paths, clock time formatting and parsing, Intervals, the App registry, the Identity Proof's shape, the User names question's. |
| `app/composables`, `app/utils` | Request feedback, forms, unsaved changes, async actions, store helpers, who am I (`useIdentity`), server time, the Clock Projection scheduler and the Frame Clock, failure sentences. Auto-imported. |
| `app/components/UI` | Confirm, empty, loading, search and tab components, as `<UI…>`. |
| `test/` | Test kits an app's tests import, the SQLite D1 harness over an app's real migrations and the auth schema contract (`authSchemaContract.ts`) and the check of each Environment's Wrangler configuration against the deploy descriptor (`wranglerEnvironments.ts`) among them, and this layer's own tests. |
| `RULES.md`, `docs/adr` | What the layer's named modules must do, and the decisions behind them (ADR-0095). Their terms are in the root `GLOSSARY.md`. |
| `vitest.shared.ts` | What an app's Vitest configurations name: the h3 Nitro runs on, the setup files, the load-tolerant bounds. |

## Rules

- **A file has the path it would have in an app.** Nuxt and Nitro auto-import it; code that names it imports `@keepr/nuxt-layer/<path>`.
- **Inside the layer, imports are relative.** `~` and `~~` are the app that extends it.
- **No route and no middleware.** An app registers its own, in its own order, and calls the layer's code.
- **Nothing here knows a product.** If it names an Event, a Screen or a Tournament, it belongs in that app.
- **A named module's term is in the root `GLOSSARY.md`**, under Platform. A module that moves here brings its term in the same change.
- **It stands alone.** `pnpm typecheck` and `pnpm test` run here, with no app around it. A rule's tests live here with the rule, but for one: `resolveRequestIdentity` is tested in `apps/accounts` (`test/unit/server/requestIdentity.sqlite.test.ts`), against Keepr Accounts' real minting, which the layer cannot import (ADR-0113, in the root `docs/adr`). How a route meets it is tested here.
- **Something two apps need moves here, in the change that moves the first app onto it.** Do not copy a file between apps.
- **Nothing here gives a Worker a binding, an entry of its own or a process in development.** That is a layer an app chooses (ADR-0138, in the root `docs/adr`), as realtime's is: `@keepr/realtime/nuxt`. This layer keeps what costs an app nothing when unused.

## Server time

`useServerTime`, and every Clock Projection on `useClockProjection`, syncs against `GET /api/time` (`SERVER_TIME_PATH`). The layer registers no route, so an app that shows server time serves it, reachable without a sign-in:

```ts
// server/api/time.get.ts
import { readServerTime } from '@keepr/nuxt-layer/server/utils/serverTime';

export default defineEventHandler(readServerTime);
```

## Release identity

The deploy's verify requires `GET /api/release` (`RELEASE_PATH`) to name the Release just deployed (ADR-0119). Every build records `{ app, version, commit }` in runtime config; the layer registers no route, so every app serves it, reachable without a sign-in:

```ts
// server/api/release.get.ts
import { readReleaseIdentity } from '@keepr/nuxt-layer/server/utils/release';

export default defineEventHandler((event) => readReleaseIdentity(useRuntimeConfig(event)));
```

## Who a request belongs to

An App relies on Keepr Accounts (ADR-0112, ADR-0113). It binds the service in both `wrangler.jsonc` and `wrangler.dev.jsonc`, by the production name, so the Accounts Stand-in, a local Keepr Accounts and production are the same to it:

```jsonc
"services": [{ "binding": "KEEPR_ACCOUNTS", "service": "keepr-accounts" }]
```

The layer registers no route and no middleware, so the App calls it from its own. Its "who am I", which `useIdentity` reads:

```ts
// server/api/identity.get.ts
import { resolveRequestIdentity } from '@keepr/nuxt-layer/server/utils/requestIdentity';

export default defineEventHandler((event) => resolveRequestIdentity(event, 'stream'));
```

and a route that needs the App:

```ts
const identity = await resolveRequestIdentity(event, 'stream');
requireAppRole(identity, 'admin'); // or requireAppAccess(identity)
```

Stream Keepr relies on it (ADR-0141, in `apps/stream/docs/adr`): its `server/utils/session.ts` is the one place that asks, and its Session boundary and page gate are built on these. An App that relies on it runs its `dev` script through the Accounts Stand-in, `keepr-accounts-stand-in -- nuxt dev` (`packages/accounts-stand-in`), and its previews, smoke runs and the servers of its integration and acceptance suites the same way (ADR-0113). Each such run keeps a Wrangler registry of its own, so two at once never meet (`packages/accounts-stand-in/README.md`). `NUXT_PUBLIC_KEEPR_ACCOUNTS_ORIGIN` points `useIdentity`'s sign-in at a local Keepr Accounts instead of `https://accounts.keepr.digital`.

## What to call another User

An App holds no Users (ADR-0112). It names the User a request belongs to from their Identity Proof, and asks Keepr Accounts what to call anyone else, from a route that has already asked who the request belongs to (ADR-0145, in the root `docs/adr`):

```ts
const names = await readUserNames(event, userIds); // { [userId]: name }
```

It forwards the request's cookie over the same binding, so Keepr Accounts answers for that Session: the names of Users who share an Organisation with its User. An id left out is unnamed, and the App shows the id. It never throws: with Keepr Accounts down, or of a Release with no such route, it answers no names. Answers are kept for five minutes. The Accounts Stand-in names the Local Developer User and whoever it has answered as since it started.

## Commands

```
pnpm typecheck   # the layer as its own app, then its tests' program
pnpm test        # the unit tests, then the Nuxt-environment tests
```
