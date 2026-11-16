# ADR-0092: The Pairing and Standings Engines are packages of the workspace, consumed as source

Accepted · 2026-11-16.

### Decision

**The five packages of the score-keepr repository are packages of this workspace: `@keepr/pairing`, `@keepr/standings`, `@keepr/engine-core` (it was `shared`), `@keepr/testkit` and `@keepr/engine-integration` (it was `integration`).** Their specs, decision records and glossary are in `apps/score`, where Score Keepr will be built on them.

**They take the workspace's tooling and none of their own.** Versions come from the catalog (ADR-0090), the lint and the format from the root (ADR-0089), the tests run on Vitest and the typecheck on `tsc`. Nothing is built or published: a package's `exports` is its `src/index.ts`.

### Why

- **Stream Keepr will pair rounds and work out standings with the engines Score Keepr runs on.** As packages of one workspace both apps read the same source at the same commit.
- **Two toolchains would be two of everything.** The engines were built with Vite+, which asks for its own Vite across a whole workspace (ADR-0089), and Stream Keepr builds with Nuxt's.
- **A build exists for a registry.** With no consumer outside the workspace there is no `dist`, no declaration files to keep honest, and no version to publish.

### Consequences

- The engines' history stays in the score-keepr repository. They arrived as one commit, from its `e9ee661`.
- They are typechecked by the workspace's TypeScript 6, not the 7 they were written against. The type-aware lint still reads them with the native one.
- They are formatted as the workspace is. A scenario's recorded answer is a text file the formatter does not read, so none changed.
- A package's source is compiled against the language alone, and its tests are a second program that may use Node (the `tsconfig.json` in its `test` directory). Both extend the root `tsconfig.base.json`.
- One engine cannot import the other: the workspace does not hoist its own packages (`hoistWorkspacePackages`), so a package resolves only the ones its `package.json` names.
- Two rules came with them, scoped to `packages/` in `.oxlintrc.json`: an export states its types, and no focused or skipped test is committed.
- Each engine echoes `ENGINE_VERSION` in its results, and a test keeps it equal to the `version` in its `package.json`. release-please does not manage that version (ADR-0091): it is the engine's, changed by hand with the rules it implements.
- CI has a `Packages` job: every package's typecheck and tests, then the Pairing Engine's speed targets. It runs on this workspace's Node alone, where the engines' own CI ran three. A change to a package still runs every gate of Stream Keepr, because CI's scope does not yet tell an app from a package.
- From the root, `pnpm verify` and `pnpm verify:quick` check the packages before Stream Keepr. The speed targets are CI's: on a machine running other gates they measure the machine.
- No app imports a package yet. Their relative imports end in `.ts`, which an app's own typecheck has to allow when the first one does.
- The engines' decision records keep their own numbering in `apps/score/docs/adr`, and their vocabulary is `apps/score/GLOSSARY.md`, apart from `apps/stream/GLOSSARY.md`.

### Rejected alternatives

- **A second repository, published to a registry.** Every change to an engine would be a release, a version bump in each app and a window in which the two apps run different engines.
- **The history brought across with the files.** Thirty-two commits whose paths, package names and tooling match nothing here; the repository they are in stays readable.
- **Their tests run from one root Vitest configuration.** Each package runs its own with no configuration at all, and a package is then whole in its directory.
