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
| `nuxt.config.ts` | The shell: client rendering, Nuxt UI, VueUse, the colour mode, strict TypeScript, the Cloudflare Workers target. |
| `server/utils` | Errors a route reports, D1 parameter helpers, the request-body ceiling, shared-secret checks, error-log fields, the server time reading. Auto-imported by Nitro. |
| `shared/` | What the server and the client both read: the state-conflict code, the body-limit route rule's types, the server time path, clock time formatting and parsing, Intervals. |
| `app/composables`, `app/utils` | Request feedback, forms, unsaved changes, async actions, store helpers, server time, the Clock Projection scheduler and the Frame Clock, failure sentences. Auto-imported. |
| `app/components/UI` | Confirm, empty, loading, search and tab components, as `<UI…>`. |
| `test/` | Test kits an app's tests import, and this layer's own tests. |
| `RULES.md`, `docs/adr` | What the layer's named modules must do, and the decisions behind them (ADR-0095). Their terms are in the root `GLOSSARY.md`. |
| `vitest.shared.ts` | What an app's Vitest configurations name: the h3 Nitro runs on, the setup files, the load-tolerant bounds. |

## Rules

- **A file has the path it would have in an app.** Nuxt and Nitro auto-import it; code that names it imports `@keepr/nuxt-layer/<path>`.
- **Inside the layer, imports are relative.** `~` and `~~` are the app that extends it.
- **No route and no middleware.** An app registers its own, in its own order, and calls the layer's code.
- **Nothing here knows a product.** If it names an Event, a Screen or a Tournament, it belongs in that app.
- **A named module's term is in the root `GLOSSARY.md`**, under Platform. A module that moves here brings its term in the same change.
- **It stands alone.** `pnpm typecheck` and `pnpm test` run here, with no app around it. A rule's tests live here with the rule.
- **Something two apps need moves here, in the change that moves the first app onto it.** Do not copy a file between apps.

## Server time

`useServerTime`, and every Clock Projection on `useClockProjection`, syncs against `GET /api/time` (`SERVER_TIME_PATH`). The layer registers no route, so an app that shows server time serves it, reachable without a sign-in:

```ts
// server/api/time.get.ts
import { readServerTime } from '@keepr/nuxt-layer/server/utils/serverTime';

export default defineEventHandler(readServerTime);
```

## Commands

```
pnpm typecheck   # the layer as its own app, then its tests' program
pnpm test        # the unit tests, then the Nuxt-environment tests
```
