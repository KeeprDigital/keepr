Keepr is one pnpm workspace (ADR-0091): each app is in `apps/`, and what apps
share is in `packages/`. This file holds what an agent must follow everywhere
in it; `apps/stream/AGENTS.md` and `apps/score/AGENTS.md` add each app's own.
`apps/stream/README.md` is the guide to setup, testing, deploy, and operations.

## Layout

- `apps/stream`: Stream Keepr (`@keepr/stream`), a Nuxt app on Cloudflare
  Workers. Its scripts run from its directory: `cd apps/stream`, then
  `pnpm dev`, `pnpm test:unit` and the rest of its README.
- `packages/`: what more than one app uses, each named `@keepr/<name>` and
  consumed as TypeScript source: the Pairing and Standings Engines
  (`pairing`, `standings`), what both use (`engine-core`), and their test
  support (`testkit`, `engine-integration`). Each has a `typecheck` and a
  `test` script; `pnpm typecheck:packages` and `pnpm test:packages` at the
  root run them all. `nuxt-layer` is the Nuxt layer every app extends, with the
  server, client and test foundation the apps share: what a second app needs
  moves there, never into a second copy. Its `README.md` has its rules.
- `apps/score`: Score Keepr (`@keepr/score`), scaffolded and not built, with
  the engines' specs and `GLOSSARY.md`: use its words in the packages. Each
  engine's decisions are in its package's `docs/adr`. `apps/score/AGENTS.md` adds its own rules.
- `GLOSSARY.md` at the root holds the words every app shares: who a person is
  and what they may use (User, Session, Organisation, App role), and the
  shared layer's named modules. Each app has a glossary of its own, and
  `GLOSSARY-MAP.md` says where each is and how they meet. A shared term is
  defined once, at the root.
- A glossary says what a word means, `RULES.md` what is true now, and a
  decision why (ADR-0095). Each sits beside the code it governs: the
  workspace's decisions are files in the root `docs/adr`, and an app's or
  package's are in its own. A decision is written once, numbered in one
  sequence for the workspace; a later one that changes it leaves it only an
  `Amended by` or `Superseded by` line.
- The root holds what every app and package shares: the dependency catalog
  (`pnpm-workspace.yaml`), the lockfile, the lint and format configuration
  (`.oxlintrc.json`, `.oxfmtrc.json`), the packages' compiler options
  (`tsconfig.base.json`) and the workflows (`.github/`).
- `pnpm lint`, `pnpm lint:fix`, `pnpm format`, `pnpm verify` and
  `pnpm verify:quick` run from the root as well as from an app. The lint and
  the format are one run over the whole workspace. From the root, the two
  verifies check the packages too; from an app, only that app.

## Before pushing

Push once `pnpm verify:quick` passes. It checks what your checkout changes
since `main`: lint (which fails on unformatted code; `pnpm lint:fix` formats),
typecheck, and the unit and Nuxt tests whose imports reach the files it
changed. CI is the full gate, and runs everything. Open the PR
as a draft, which CI skips, and mark it ready when the branch is done: that
runs every gate `pnpm verify` runs, Worker build and workerd smoke included.
Realtime integration tests are the exception: CI has no Ably key, so they run
only against your local `apps/stream/.env`. A change touching realtime needs
`pnpm test:integration --run` green in `apps/stream` before you mark it
ready. Reach for `pnpm verify` to reproduce a CI failure locally. A
dependency's version lives in the catalog in `pnpm-workspace.yaml`, and each
`package.json` names it as `catalog:`; `pnpm add`, run in the app or package
that needs it, writes both. Commit `pnpm-lock.yaml` with any change to either
that affects dependency resolution.

## Landing on main

Every change reaches `main` as a squash-merged PR whose title is a Conventional
Commit (`fix(scope): summary`); release-please reads that one commit, and CI
runs only on PRs and in the merge queue. Open the PR from your branch and leave
`main` itself to the merge queue. Why: `apps/stream/README.md` § Releases.

## Worktrees and processes

- A new worktree has no `.env`, `node_modules`, or `.nuxt`: copy
  `apps/stream/.env` from the main checkout to the same place, then
  `pnpm install --frozen-lockfile`. Missing `.env`
  produces 503s and skipped realtime tests, not branch defects.
- Stop dev servers with SIGINT/SIGTERM. `pnpm reap` safely removes orphaned
  `workerd`; scope any manual kill to your worktree's path
  (`pkill -f "<worktree path>/.*workerd"`), never bare `pkill -f workerd`.
- Every heavy gate takes run slots from one budget for the whole machine,
  shared with every other worktree, and waits its turn when there are none. A
  `[run-slots] … has waited` line is the queue, not a hang: leave it, or read
  the line with `pnpm slots`. Start a suite or `pnpm verify` in the background
  rather than under a short timeout, and never start a second copy of a run
  that is waiting.

## Issue tracker

Issues and PRDs live in GitHub Issues; use `gh`, which infers the repo.

- Read: `gh issue view <n> --json number,title,state,body,comments,labels`. Use
  the JSON form, because plain `gh issue view` has silently dropped output here.
- Create: `gh issue create --title "…" --body "…"` (heredoc for multi-line).
  Comment: `gh issue comment`. Labels: `gh issue edit --add-label/--remove-label`.
  Close: `gh issue close <n> --comment "…"`.
- "Publish to the issue tracker" means create an issue; "fetch the ticket" means
  read it as above.
- External PRs are not a triage surface.

### Triage labels

| Label                 | Meaning                                                               |
| --------------------- | --------------------------------------------------------------------- |
| `needs-triage`        | Maintainer needs to evaluate                                          |
| `needs-info`          | Waiting on reporter                                                   |
| `ready-for-agent`     | Fully specified, ready for an AFK agent                               |
| `ready-for-human`     | Requires human implementation                                         |
| `wontfix`             | Will not be actioned                                                  |
| `requires-deployment` | Remaining verification needs a human-authorized deploy (composes with the above) |

Having production credentials is not authorization to use them. Finish the
local evidence, apply `requires-deployment`, and leave the deploy and the
ticket's close to a human.

### Wayfinding

Used by `/wayfinder`. The **map** is one issue labelled `wayfinder:map`
(Notes / Decisions-so-far / Fog body). **Child tickets** are GitHub sub-issues of
the map, labelled `wayfinder:<research|prototype|grilling|task>`. If
sub-issues are unavailable, list them in the map body and put `Part of #<map>`
atop the child.

- **Blocking**: native issue dependencies:
  `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`,
  where the db id is `gh api repos/<owner>/<repo>/issues/<n> --jq .id`. Fallback:
  a `Blocked by: #<n>` line atop the child. A ticket is unblocked when every
  blocker is closed.
- **Frontier**: the map's open children with no open blocker and no assignee;
  first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me` as the first write.
- **Resolve**: comment the answer, close, then append a gist + link to the
  map's Decisions-so-far.
