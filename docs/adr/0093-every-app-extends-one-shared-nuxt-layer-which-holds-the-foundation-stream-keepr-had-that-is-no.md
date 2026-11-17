# ADR-0093: Every app extends one shared Nuxt layer, which holds the foundation Stream Keepr had that is no product's own

Accepted · 2026-11-16 · Amended by ADR-0112: the layer holds the App registry and the SQLite D1 harness; sign-in is Keepr Accounts'

### Decision

**`packages/nuxt-layer` (`@keepr/nuxt-layer`) is the Nuxt layer every app of the workspace extends.** It holds what an app is before it is anything else: client rendering, Nuxt UI, VueUse, the colour mode, strict TypeScript and the Cloudflare Workers target.

**It also holds the foundation Stream Keepr had built that is not about streaming: moved there in one pass, before Score Keepr needed any of it.**

- Server: the errors a route reports (`StateConflictError`, `ServiceConfigurationError`, `TemporarilyUnavailableError`), the D1 parameter helpers, the request-body ceiling and its route rule, shared-secret checks, error-log fields.
- Client: the request-feedback, form, unsaved-changes and async-action composables, the store helpers, server time, the failure sentences, and the confirm, empty, loading, search and tab components.
- Tests: the Nuxt UI stubs, `deferred`, the h3 event, the load-tolerant waits, the credential guard, and the Vitest pieces both apps' configurations name.

**A file keeps the path it had, under the layer.** The server's errors module is `packages/nuxt-layer/server/utils/errors.ts`, so Nuxt and Nitro auto-import it as before, and code that names it imports `@keepr/nuxt-layer/server/utils/errors`.

**The layer registers no route and no middleware.** An app states its own API surface and the order its middleware runs in, calling the layer's code from a file of its own.

**The layer stands alone.** Its typecheck and its tests run in its own directory, as an app with nothing but itself, and each rule's tests moved with the rule.

### Why

- **Score Keepr starts on what Stream Keepr learned, not beside it.** Extracted later, piece by piece, each piece would have been copied first and reconciled after; extracted once, there is one of each from Score Keepr's first route.
- **A layer that typechecks alone cannot lean on an app.** That run found the one hidden dependency of the move, a component using VueUse through Stream Keepr's module list, which no import statement showed.
- **Routes and middleware stay in the app because their meaning is in their company.** Stream Keepr's body ceiling runs after its session check, and its count of public routes is a decision record (ADR-0010) held by a test that reads the routes on disk. A route arriving from a layer would be in neither.

### Consequences

- Stream Keepr's build is the same with the shell in the layer: the files that differ from a build before it are the ones that differ between any two builds.
- What is generic in purpose but still written around Stream Keepr stayed, each for a named reason: sign-in (its host, its bypass and its tables are Stream Keepr's), the `/api` session boundary (its exemptions are routes), the Nitro error mapping (it imports graphics and Melee errors), realtime (channels are an Event's), and the D1 and R2 test harnesses (typed by an app's Worker bindings, which the layer has none of).
- Two modules were split to move their generic half: the Deck-source errors are `server/utils/deckSourceErrors.ts`, and the TCG+ ceiling is `shared/utils/tcgPlusImportLimits.ts`.
- Neither app sets Nuxt UI's colours. Stream Keepr's `app.config.ts` was at the app's root, where Nuxt 4 does not read it, so the app has always shown the defaults; the file is gone, and the palette is a decision still to make.
- The lockfile's new importers name the versions Stream Keepr already resolves, so no dependency of Stream Keepr's changed.
- The layer's typecheck and tests run with the packages' (`pnpm typecheck:packages`, `pnpm test:packages`), in CI's `Packages` job.
- A change to the layer or to Score Keepr runs every gate of Stream Keepr, until CI's scope is per app (ADR-0091).

### Rejected alternatives

- **Extraction on demand**, each piece moving when Score Keepr first needed it. It was the first decision here, reversed the same day: it defers the cost without reducing it, and leaves the second app to be built against a foundation that is not there yet.
- **Score Keepr started from a copy of Stream Keepr.** It would inherit more than fifty tables, a realtime plugin and a deploy procedure for a product it is not.
- **Routes and middleware registered by the layer.** Convenient for the second app, and invisible in the first: see Why.
- **A layer inside one app, or a `layers/` directory at the root.** The workspace already has one place for what apps share, and a package there is linked, versioned and linted like the others.
