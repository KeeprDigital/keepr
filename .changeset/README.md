# Changesets

Each file here is a changeset: the apps a change ships in, each with its bump, and the line its Release's changelog gets (ADR-0118, in the root `docs/adr`). `pnpm changeset` writes one; `pnpm changeset --empty` writes one that names no app. The root `AGENTS.md` § Before pushing says when a change needs one and what each bump means.

A Release's notes group its changesets by the title of the PR that added each: Operator steps (every major), Features (`feat`), Fixes (`fix`) and Other changes (ADR-0126). `config.json` names the changelog formatter that reads it, `packages/tooling/scripts/changelog.mjs`, and `pnpm release:version`, which the Version PR runs, regroups each new section after `changeset version`; run `changeset version` alone and the new section keeps Changesets' Major/Minor/Patch headings.

`config.json` names the apps Changesets ignores: an app without a deploy descriptor, and the packages that carry a version of their own. Packages are consumed as source and are never versioned (ADR-0092).
