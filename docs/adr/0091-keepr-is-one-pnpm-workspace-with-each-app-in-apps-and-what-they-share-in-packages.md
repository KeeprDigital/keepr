# ADR-0091: Keepr is one pnpm workspace, with each app in `apps/` and what they share in `packages/`

Accepted · 2026-11-16 · Amended by ADR-0118: each versioned app has its own Releases, version and `CHANGELOG.md`, released through Changesets

### Decision

**The repository is a pnpm workspace. Stream Keepr is `apps/stream` (`@keepr/stream`); another app sits beside it, and code more than one app uses is a package in `packages/`, named `@keepr/<name>` and consumed as its TypeScript source.** The root holds what all of them share: the catalog and the lockfile (ADR-0090), the lint and format configuration (ADR-0089), and the workflows. An app's directory holds everything else of that app, its scripts, tests and documents included.

**The lint and the format are one run over the workspace, from the root's configuration.** An app's own rules are entries of that configuration scoped to its paths. `pnpm lint` in an app is the workspace's.

### Why

- **Score Keepr is a second app, and its pairing and standings engines are packages Stream Keepr will use too.** Two repositories would share them through a registry or a copy; a workspace shares them as source, at one version of every dependency.
- **A new app or package is linted and formatted the day it exists.** With one configuration at the root there is nothing for it to write, and no second style to drift.
- **The app moved whole.** Everything in `apps/stream` names its neighbours as it did at the root, so the move changed only what names the repository itself: the workflows, the paths git reports, and the release configuration.

### Consequences

- A path git reports begins `apps/stream/` (`packages/tooling/scripts/ci-scope.mjs`), and each CI job that runs the app's scripts runs them in its directory.
- The Deploy workflow deploys any release with the tooling of `main`, so that tooling finds the app in either layout: `apps/stream`, or the root of a release from before the workspace (`appDirectory` in `scripts/deploy-promotion.mjs`).
- The validator's fingerprint changed once without its code changing: the bundle names each module it inlines by a path relative to the Worker, and `@cloudflare/containers` is now two directories further up. The first deploy after the move promotes the validator unless it is dispatched with `validator: never`.
- release-please still releases the repository as one package at its root, and bumps the version in the root's manifest and the app's. Its notes for a release are the commits that touch the package's path, and every commit from before the move touches a path outside `apps/stream`; a package at that path would have dropped them from the next release. A second app that releases makes each a component of its own, at a release boundary.
- The verify graph, the run slots and CI's scope are still Stream Keepr's scripts, though the workspace's lint and the workflows call them. They move to the root when a second app needs gating.
- The rules for agents are two files: the workspace's at the root, and the app's beside its code. The root `CLAUDE.md` loads both.
- A worktree's `.env` is `apps/stream/.env`.

### Rejected alternatives

- **A configuration per app, extending a shared base.** Each app would carry a file whose only content is the extension, and a rule changed in one place could be overridden in another.
- **A task runner over the workspace (Turborepo, Nx, Vite+).** `scripts/verify.mjs` already orders the gates and the run slots already budget them across worktrees. With one app there is nothing to cache or to skip between packages; ADR-0089 has why not Vite+.
- **Packages built to `dist`.** A build step between a package's source and its consumer is a watch process in development and a stale artefact in a typecheck.
