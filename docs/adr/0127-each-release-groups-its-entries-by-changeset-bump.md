# ADR-0127: Each Release groups its entries by changeset bump

Accepted · 2026-11-18 · [#1284](https://github.com/KeeprDigital/keepr/issues/1284), part of [#525](https://github.com/KeeprDigital/keepr/issues/525) · Amends ADR-0126

### Decision

**A Release's sections come from each changeset's bump; the PR's title only labels the entry.** Each new section of an app's `CHANGELOG.md`, and so its GitHub Release notes, reads:

- **Operator steps**: every major changeset.
- **Features**: every minor changeset, whatever its PR's type.
- **Fixes**: a patch changeset whose PR is a `fix`.
- **Other changes**: every other patch, including a `feat`, and a patch whose commit cannot be read or whose subject is not Conventional.

The rest of ADR-0126 stands: the order, a heading with no entry left out, the entry `- **<scope>:** <the changeset's summary> (#<PR>)` with its scope and PR read from the squash commit with git, and `pnpm release:version` regrouping only the newest section.

### Why

- **The bump already means what the sections mean.** The root `AGENTS.md` § Before pushing defines major as an operator step, minor as something a User or operator can newly do, patch as everything else that ships. Sections drawn from it say what the author chose for the Release.
- **Two classifications disagreed.** Release 1.9.0 put #1277 (a minor, `build(stream)`: a new Staging Installation) under Other changes, and #1279 (a patch, `feat(deploy)`) under Features. A PR's type describes the whole PR, often its tooling; the bump describes what the app's Release gains.
- **Fixes stay apart within patches.** A patch is too broad to read as one list, and `fix` is the one type that names what a reader of a patch looks for.

### Consequences

- A Conventional Commit type no longer moves an entry into Features; only a minor does. ADR-0126's "a PR's title is worth writing for the Release it lands in" holds for its scope, its PR number and, for a patch, whether it is a fix.
- Published sections keep their format: `1.9.0` stays grouped by type, `1.8.0` and older by bump.

### Rejected alternatives

- **Keep grouping by type.** It makes the author choose twice, and the two choices disagreed in the first Release that used it.
- **A Fixes section for a `fix` at any bump.** A minor `fix` is still something newly possible, and a major one still needs its step; the bump decides first.
