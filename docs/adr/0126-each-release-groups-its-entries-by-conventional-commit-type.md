# ADR-0126: Each Release groups its entries by Conventional Commit type

Accepted · 2026-11-18 · Amends ADR-0118

### Decision

**An app's Release section groups its entries by what the reader needs, not by bump.** Each new section of an app's `CHANGELOG.md`, and so its GitHub Release notes, reads:

- **Operator steps**: every major changeset, whatever its type. A major still means what the root `AGENTS.md` § Before pushing says: the deploy needs a step beyond running Deploy, and the changeset states it.
- **Features**: the minor and patch changesets whose PR is a `feat`.
- **Fixes**: those whose PR is a `fix`.
- **Other changes**: every other type, and a changeset whose commit cannot be read or whose subject is not Conventional.

A heading with no entry is left out. Each entry is `- **<scope>:** <the changeset's summary> (#<PR>)`, without the scope or the PR when the title has none.

**The PR's title says the type, scope and PR; the changeset says the rest.** A changelog formatter (`packages/tooling/scripts/changelog.mjs`, named by `.changeset/config.json`'s `changelog`) reads, with git, the subject of the commit that added each changeset: on `main`, the PR's squash commit, whose subject is its checked Conventional Commit title. No GitHub API is read.

**`pnpm release:version` regroups after Changesets.** Changesets core groups a Release's lines under `### Major/Minor/Patch Changes` and cannot be configured otherwise, so the formatter marks each line with its bump and type, and the same module, run after `changeset version`, rewrites only the newest section of each versioned app's CHANGELOG into the groups above, leaving no marker and none of Changesets' headings. A section with no marker is left alone, so the step is idempotent and older sections, in any format, are never touched. `changesets/action` versions with `version: pnpm release:version`.

### Why

- **A reader scans for what changed for them.** Major/Minor/Patch says how far a version moved; the operator needs the steps, and everyone else wants features apart from fixes and housekeeping. The Conventional Commit type already says which, on every PR.
- **The bump keeps its one meaning.** Grouping majors as Operator steps, apart from their type, is ADR-0118's reason for bumps made visible.

### Consequences

- ADR-0118's "Conventional Commit titles … no longer drive a version or a changelog" is half true: they still drive no version, but they now group the changelog. A PR's title is worth writing for the Release it lands in.
- `1.8.0` and older keep the format they were written in.
- Run `changeset version` alone and the markers stay, invisible in rendered Markdown; `pnpm release:version` is the command.

### Rejected alternatives

- **`@changesets/changelog-github`.** It links PRs and authors through the GitHub API, needs a token in the Version PR's job, and still groups by bump.
- **A type in each changeset's front matter.** The PR title is already checked to carry it; a second copy could disagree.
