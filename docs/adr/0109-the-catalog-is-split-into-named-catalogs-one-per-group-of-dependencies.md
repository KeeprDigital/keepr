# ADR-0109: The catalog is split into named catalogs, one per group of dependencies

Accepted · 2026-11-17 · Amends ADR-0090

### Decision

**`pnpm-workspace.yaml` holds every dependency's version in the named catalog of its group, and `package.json` names each dependency as `catalog:<group>`.** The groups are `framework`, `charts`, `fonts`, `images`, `server`, `cloudflare`, `test` and `tooling`. A dependency is in one group, so its version is still stated once (ADR-0090). The `@nuxt/fonts` override names `catalog:framework`.

### Why

- **One flat list of sixty versions hides what goes together.** A refresh of Vitest and its plugins, or of Nuxt and its modules, is one group to read, and a `package.json` says which part of the stack each dependency belongs to.
- **Comments alone do not travel.** A heading in `pnpm-workspace.yaml` is invisible from a `package.json`, and nothing stops `pnpm add` placing an entry under the wrong one. A named catalog is part of the reference.

### Consequences

- `pnpm add` takes `--save-catalog-name=<group>`; without it the version lands in the default catalog, which is empty, and the entry belongs in a group.
- ADR-0090's last consequence no longer holds as written: a named catalog is a group, not a way for one package to differ. A package that must differ on one dependency takes a further named catalog for that version.
- `test/unit/shared/applicationFontWiring.test.ts` reads the pin from the catalog each `package.json` entry names.
