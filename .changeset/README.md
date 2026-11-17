# Changesets

Each file here is a changeset: the apps a change ships in, each with its bump, and the line its Release's changelog gets (ADR-0118, in the root `docs/adr`). `pnpm changeset` writes one; `pnpm changeset --empty` writes one that names no app. The root `AGENTS.md` § Before pushing says when a change needs one and what each bump means.

`config.json` names the apps Changesets ignores: an app without a deploy descriptor, and the packages that carry a version of their own. Packages are consumed as source and are never versioned (ADR-0092).
