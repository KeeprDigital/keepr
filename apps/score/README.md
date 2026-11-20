# Score Keepr

Tournament engines: one decides who plays whom, one works out the standings. Both are pure functions with no runtime dependencies outside this repository.

The app that runs a tournament with them is scaffolded, not built: a Nuxt app (`@keepr/score`) on the workspace's shared layer, with one page that names the engines it reads. This directory also holds what it will be built from: the engines' specs, the decisions behind them, and the vocabulary. The engines themselves are packages of the Keepr workspace, in `packages/` at the repository's root, so any app can use them.

## Layout

Paths beginning `packages/` are from the repository's root; the rest are from this directory.

| Path | What |
|---|---|
| `packages/pairing` | Pairing Engine (`@keepr/pairing`): Swiss, Single Elimination, checking hand-made Pairings. |
| `packages/standings` | Standings Engine (`@keepr/standings`): Standings and Final Placings. |
| `packages/engine-core` | `@keepr/engine-core`: types, the seeded-random routine and mapping functions both engines use. |
| `packages/testkit` | `@keepr/testkit`: test helpers, scenario files with recorded answers. |
| `packages/engine-integration` | `@keepr/engine-integration`: whole events played through both engines. |
| `packages/*/RULES.md` | The exact rules each engine follows; `packages/*/README.md` says how to call it. |
| `RULES.md` | The Tournament Engine's settled rules, and what this app must do as the engines' Consumer. |
| `docs/tournament-spec.md` | Tournament Engine spec. Designed, not built. |
| `docs/adr/` | The Tournament Engine's decisions. Each engine's are in its package's `docs/adr`. |
| `GLOSSARY.md` | The engines' vocabulary. Use these words. |
| `docs/prototype-matcher/` | Throwaway prototype of the matcher. Not linted, formatted or run. |
| `app/`, `test/`, `nuxt.config.ts` | The app's scaffold. |
| `packages/nuxt-layer` | `@keepr/nuxt-layer`: what every Keepr app starts from. |

Both engines are built. Each package's README says what is measured and what is not. A third, the Tournament Engine, is designed in `docs/tournament-spec.md` and not yet built: it turns the record of a tournament into its current state and calls the other two.

## The app

In this directory:

```
pnpm dev          # the placeholder, on Nuxt's dev server
pnpm typecheck
pnpm test         # one page test, in the Nuxt environment
pnpm build        # the Worker bundle; nothing deploys it yet
pnpm verify       # the three above, as CI's `Score Keepr` job runs them
```

It extends `packages/nuxt-layer`: the Nuxt shell, and the server, client and test foundation it shares with Stream Keepr. It adds only its own, and it has no sign-in, no database and no deployment.

## Commands

From the repository's root:

```
pnpm install
pnpm typecheck:packages   # every package's types, its tests' included
pnpm test:packages        # every package's tests
pnpm bench:packages       # each package's speed targets (`bench:check`); today the Pairing Engine's
pnpm lint                 # format and lint, the whole workspace
pnpm verify:quick         # all of the above but the speed targets, then Stream Keepr's quick gates
```

In one package's directory:

```
pnpm test                 # vitest run
pnpm test -u              # re-record scenario answers after an intended change
pnpm typecheck
pnpm bench:check              # packages/pairing: its speed targets
pnpm bench 10001 15 --check   # packages/pairing: time a simulated event
```

CI runs the typecheck, the tests and the speed targets in its `Packages: Engines` job (`.github/workflows/ci.yml`), for every pull request and merge group whose change affects an engine (ADR-0147, ADR-0149).

## Rules the setup enforces

- `pairing` and `standings` each depend on `engine-core` only. Importing one from the other does not resolve: the workspace does not hoist its own packages (`hoistWorkspacePackages` in `pnpm-workspace.yaml`).
- Source is compiled against the language library alone. `console`, `fetch`, `process` and the DOM do not typecheck, so engine code cannot do I/O by accident. A package's tests are a second program (`test/tsconfig.json`) that may use Node.
- Every export in a package states its types in full (isolated declarations). The typecheck fails otherwise, and the lint flags exported functions that leave them out.
- Packages are consumed as TypeScript source. Nothing is built or published (ADR-0092, in the root `docs/adr`).
