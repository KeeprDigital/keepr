# ADR-0138: Realtime's Nuxt glue is a layer of its own inside `@keepr/realtime`, which an app that wants realtime extends

Accepted · 2026-11-19 · [#1314](https://github.com/KeeprDigital/keepr/issues/1314), part of [#1310](https://github.com/KeeprDigital/keepr/issues/1310) · Amends ADR-0093 and ADR-0137

ADR-0137 gave realtime's Nuxt glue to `packages/nuxt-layer`, the layer every app extends. Keepr Accounts extends it and has no realtime.

### Decision

**The glue is a second Nuxt layer, in `packages/realtime/nuxt`, which the package exports as `@keepr/realtime/nuxt`.** It holds what ADR-0137 gave to `packages/nuxt-layer`: the Worker entry that exports the object's class and hands a socket to it, the server's publish by RPC, and the Worker that holds the class beside `nuxt dev`.

**An app that wants realtime extends both layers.** An app that does not names neither the realtime layer nor the package.

```ts
export default defineNuxtConfig({
	extends: ['@keepr/nuxt-layer', '@keepr/realtime/nuxt'],
});
```

**The package's source outside `nuxt/` keeps no framework.** The object, the wire protocol and the client transport are built and tested as before, in local `workerd` and Node. Nuxt is a peer dependency that only `nuxt/` reads.

**The realtime layer keeps the shared layer's rules** (ADR-0093): no route, no middleware, no product's name, and it typechecks and tests alone.

**What gives a Worker a binding, an entry of its own or a process in development is a layer an app chooses, never part of `packages/nuxt-layer`.** The shared layer keeps what costs an app nothing when unused. Nothing it holds today moves.

### Why

- **Choosing is one line.** In the shared layer the entry would need a flag every app reads, and Keepr Accounts would carry glue it never turns on.
- **One package owns realtime.** The object, its protocol, the client transport and the glue that hands a socket to the object change together.
- **A realtime change reaches only the apps that have realtime.** An app's shipped code is every workspace package its dependencies reach (ADR-0118). With the glue in the shared layer, each change to `@keepr/realtime` would need a changeset naming Keepr Accounts.
- **Unused helpers cost nothing; an entry and a binding do.** Nitro and Nuxt leave an unused auto-import out of the build. A Worker entry, a Durable Object binding and a second process in development are there whether or not anything calls them.

### Evidence

A throwaway probe on Score Keepr, never merged (Nuxt 4.6.4, c12 3.3.4): with `"./nuxt": "./nuxt/nuxt.config.ts"` in the package's `exports` and the second `extends`, `loadNuxtConfig` listed `apps/score`, `packages/nuxt-layer` and `packages/realtime/nuxt` as its layers, and read a runtime config value only the probe's layer set.

Not shown: the Worker entry, the publish helper and the dev Worker working from that folder. That is #1314.

### Consequences

- **The package's `typecheck` gains a Nuxt program**, so CI's `Packages` job runs longer.
- **#1314 builds the layer there**, and Stream Keepr takes `@keepr/realtime` as a dependency and the second `extends` in that change. `packages/nuxt-layer/README.md` and the root `AGENTS.md` state the rule above in the same change.
- **Score Keepr takes realtime by the `extends` line, the dependency and its own binding.**

### Rejected alternatives

- **The glue in `packages/nuxt-layer`**, ADR-0137's first choice, turned on by configuration. The reasons above.
- **A sibling package for the layer.** It keeps Nuxt out of `@keepr/realtime`'s gates, at the cost of a second package that changes with the first. It was the fallback had Nuxt not resolved a layer from a package's subpath.
- **Limiting `packages/nuxt-layer` to what every app uses.** Its rule is what two apps need, and it has held `resolveRequestIdentity` since before any App relied on it. An unused helper costs nothing, so there is nothing to gain by moving one out.
