# ADR-0118: Changesets replaces release-please, and each versioned app has its own Releases

Accepted · 2026-11-17 · [#1260](https://github.com/KeeprDigital/keepr/issues/1260), part of [#1258](https://github.com/KeeprDigital/keepr/issues/1258) · Amended by ADR-0124: `changesets/action` writes with the release GitHub App's token, in the `release` environment, so the Version PR's runs need no approval · Amended by ADR-0125: the Version PR is a draft until a person marks it ready, and a Release deploys itself to staging, then to production behind one approval · Amended by ADR-0126: each Release groups its entries by Conventional Commit type, majors as Operator steps · Amended by ADR-0154: the root `package.json` and `tsconfig.base.json` are shipped by every app, and deleting a changeset names an app only when the change moves its version

### Decision

**Changesets versions the workspace's apps, and release-please is gone.** The author of a change names the apps it ships in, each with its bump, in a changeset (`.changeset/*.md`, written by `pnpm changeset`). Each versioned app has its own Releases: its own version in its `package.json`, its own `CHANGELOG.md` in its directory, its own tag `<package>@<version>` (`@keepr/stream@1.7.0`) and its own GitHub Release.

**Only an app with a deploy descriptor is versioned.** Today that is Stream Keepr. `.changeset/config.json` ignores every other app (Score Keepr, Keepr Accounts) until it has one; Keepr Accounts joins at `0.1.0` with its descriptor (#1255). Packages are consumed as source (ADR-0092) and are never versioned: the config also ignores the two that carry a version of their own, the Pairing and Standings Engines, whose version is their `ENGINE_VERSION`. `privatePackages` is `{ version: true, tag: true }`, since every app is private.

**One Version PR for every app.** `changesets/action` (`.github/workflows/release.yml`) opens it from the changesets waiting on `main`, and merging it through the merge queue releases every app it names at once. Deploying stays per app.

**The release gate stays upstream of tagging** (ADR-0036). With no changeset waiting, the action runs the publish script, `pnpm release:publish`: `release-gate.mjs`, then `changeset git-tag`. The gate refuses when a tag is due and `HEAD` passed no merge-group run of CI. The action pushes each tag `changeset git-tag` reports and makes its GitHub Release from the app's `CHANGELOG.md`.

**A change names each versioned app whose shipped code it touches in a changeset, or carries an empty one,** and the bump says what the operator deploying it must know. The root `AGENTS.md` § Before pushing holds what shipped code is and what each bump means; `packages/tooling/scripts/changeset-check.mjs` checks the first, in CI's `checks` job and in `pnpm verify:quick`. A changeset counts when the change adds, edits or consumes it, so the Version PR passes. Only an app may carry a version Changesets reads, since `changeset git-tag` tags whatever does.

**Conventional Commit titles stay checked, for history only.** They no longer drive a version or a changelog.

### Why

- **release-please routes a commit to a component by its path, and has no `additional-paths`.** A change to `packages/nuxt-layer` touches no app's path, so it would release no app, though every app ships it. With Changesets the author says which apps a change ships in, and the check refuses a change that touches an app's shipped code without saying.
- **Keepr Accounts must be released and deployed on its own** (#1255), and before the apps that depend on it. One `vX.Y.Z` for the repository names no app.
- **Bumps say what the operator must know.** A conventional commit's type says what kind of change it is; the operator deploying a Release needs to know whether Deploy alone is enough. The author knows, and says it in the changeset.

### Consequences

- `CHANGELOG.md` is `apps/stream/CHANGELOG.md`. Changesets adds each Release's section under its first line.
- `release-please-config.json`, `.release-please-manifest.json` and the root `package.json`'s version are gone. `release-please.yml` is `release.yml`, keeping its concurrency group and the gate.
- `v1.6.0`'s commit carries `@keepr/stream@1.6.0` too, with its GitHub Release, so Deploy resolves only `@keepr/stream@*`. The `v*` tags stay as history and never deploy: none survives the ADR-0083 wipe.
- Empty changesets wait in `.changeset/` until a Version PR consumes them; alone, they open none.
- The Version PR lands alone. In one push with a PR that carries a changeset, the action finds a changeset waiting and refreshes the Version PR instead of tagging, and that version is never tagged (`apps/stream/README.md` § Releases).
- The Version PR's runs still need a maintainer's "Approve workflows to run" until a GitHub App's token opens it (#1261).
- The `release tags` ruleset makes `@keepr/*` immutable as well as `v*`.

### Rejected alternatives

- **release-please with one component per app.** It cannot route a change in a shared package to the apps that ship it.
- **A Version PR per app.** Releasing is joint and rare; one PR to approve and queue is less ceremony than several, and deploying stays per app.
- **Versioning the packages.** They are consumed as source and never published (ADR-0092); a version of theirs would describe nothing anyone deploys.
- **`changeset status --since=main` as the check.** It counts any file in a package's directory, tests and docs included, misses the lockfile and the catalog, and knows nothing of what an app ships from the packages it depends on.
