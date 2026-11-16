# ADR-0090: Every dependency's version is stated once, in a pnpm catalog

Accepted · 2026-11-15.

### Decision

**The catalog in `pnpm-workspace.yaml` holds every dependency's version, and `package.json` names each dependency as `catalog:`.** `pnpm add` writes the version to the catalog, exact (`catalogMode: strict`, `saveExact`), and an entry no package names is removed on install (`cleanupUnusedCatalogs`). The `@nuxt/fonts` override names the catalog too, so it cannot drift from the pin.

### Why

- **The repository is becoming a workspace of several apps and packages.** With a version in each `package.json`, two packages come to hold two versions of Vue, Nuxt or Zod, and the difference surfaces as a type that is not assignable to itself or a second copy in a bundle. A package that names `catalog:` takes the version every other package has.
- **A dependency refresh is one file's diff.**

### Consequences

- A version is no longer in `package.json`, for a reader or a script: `test/unit/shared/applicationFontWiring.test.ts` reads the catalog for the pins it checks.
- Every dependency is in the catalog, one package's alone included. "Versions live in the catalog" is a rule that needs no judgement about which dependencies are shared.
- A package that must differ on one dependency takes a named catalog, not a version of its own.
