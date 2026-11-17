# Keepr

One pnpm workspace for the Keepr apps and what they share (ADR-0091).

| Path          | Holds                                                                                                                       |
| ------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `apps/stream` | Stream Keepr (`@keepr/stream`): event management and streaming overlays for tournaments. Its `README.md` is the full guide. |
| `apps/score`  | Score Keepr (`@keepr/score`). Scaffolded, not built: a placeholder app, and the specs, decisions and glossary of its engines. |
| `packages/`   | What more than one app uses, each named `@keepr/<name>`: the Pairing and Standings Engines (ADR-0092), and the Nuxt layer every app extends, with the foundation they share (ADR-0093). |

The root holds what every app and package shares:

- `pnpm-workspace.yaml`: the workspace, and the catalog that states every
  dependency's version once (ADR-0090). `pnpm-lock.yaml` is the one lockfile.
- `.oxlintrc.json` and `.oxfmtrc.json`: one lint and one format for the whole
  workspace (ADR-0089). An app's own rules are entries scoped to its paths.
- `tsconfig.base.json`: the compiler options every package extends.
- `.github/`: CI, the merge queue's checks, releases and the deploy.
- `AGENTS.md`: the rules for coding agents, everywhere in the workspace.
- `.changeset/`: the changesets waiting for the next Version PR, and which
  apps Changesets versions (ADR-0118). Each versioned app's `CHANGELOG.md`, in
  its directory, is generated from them; never edit one by hand.

## Working in it

```bash
pnpm install       # the whole workspace, from anywhere in it
cd apps/stream     # an app's scripts run from its directory
pnpm dev
```

`pnpm lint`, `pnpm lint:fix`, `pnpm format`, `pnpm verify` and
`pnpm verify:quick` also run from the root, where the two verifies check the
packages as well (`pnpm typecheck:packages`, `pnpm test:packages`). Everything else about setup,
testing, releasing and deploying is in [apps/stream/README.md](apps/stream/README.md),
and the decisions behind it in [apps/stream/docs/adr](apps/stream/docs/adr). The
workspace's own decisions are in [docs/adr](docs/adr).
