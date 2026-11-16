# @keepr/nuxt-layer

The Nuxt layer every Keepr app extends (ADR-0093 in `apps/stream/DECISIONS.md`).

```ts
export default defineNuxtConfig({
	extends: ['@keepr/nuxt-layer'],
});
```

## What it holds

| Path | Holds |
|---|---|
| `nuxt.config.ts` | The shell: client rendering, Nuxt UI, VueUse, the colour mode, strict TypeScript, the Cloudflare Workers target. |
| `server/utils` | Errors a route reports, D1 parameter helpers, the request-body ceiling, shared-secret checks, error-log fields. Auto-imported by Nitro. |
| `shared/` | What the server and the client both read: the state-conflict code, the body-limit route rule's types. |
| `app/composables`, `app/utils` | Request feedback, forms, unsaved changes, async actions, store helpers, server time, failure sentences. Auto-imported. |
| `app/components/UI` | Confirm, empty, loading, search and tab components, as `<UI…>`. |
| `test/` | Test kits an app's tests import, and this layer's own tests. |
| `vitest.shared.ts` | What an app's Vitest configurations name: the h3 Nitro runs on, the setup files, the load-tolerant bounds. |

## Rules

- **A file has the path it would have in an app.** Nuxt and Nitro auto-import it; code that names it imports `@keepr/nuxt-layer/<path>`.
- **Inside the layer, imports are relative.** `~` and `~~` are the app that extends it.
- **No route and no middleware.** An app registers its own, in its own order, and calls the layer's code.
- **Nothing here knows a product.** If it names an Event, a Screen or a Tournament, it belongs in that app.
- **It stands alone.** `pnpm typecheck` and `pnpm test` run here, with no app around it. A rule's tests live here with the rule.
- **Something two apps need moves here, in the change that moves the first app onto it.** Do not copy a file between apps.

## Commands

```
pnpm typecheck   # the layer as its own app, then its tests' program
pnpm test        # the unit tests, then the Nuxt-environment tests
```
