The workspace's rules are in the root `AGENTS.md`. These are Stream Keepr's
own, and `README.md` here is its guide to setup, testing, deploy, and
operations. Paths in this file are relative to `apps/stream`.

## Local auth bypass

- `STREAM_KEEPR_LOCAL_AUTH_BYPASS` is written only in the `package.json`
  `:bypass` scripts. Keep it out of `.env`, `.env.example`, `wrangler.jsonc`,
  CI, and Worker vars: a deployed installation carrying it serves the app
  unauthenticated.
- Nothing needs it set. No build, suite, or gate depends on it; a task that
  seems to has been misread.

## Domain docs

- Before exploring, read `GLOSSARY.md`, then the `RULES.md` sections touching
  your area and the decisions in `docs/adr` they cite. `GLOSSARY.md` says what
  each thing is; `RULES.md` says what it must do, under the same headings.
- Name domain concepts with `GLOSSARY.md` terms, never its `_Avoid_` synonyms. A
  missing term is either invented language (reconsider) or a real gap (add it).
- If your output contradicts a decision, say so explicitly ("Contradicts
  ADR-NNNN — worth reopening because…") rather than silently overriding it.
- A rule that changes is edited in `RULES.md`. Record why as a new file,
  `docs/adr/NNNN-slug.md`, with the next number free in the workspace, and
  give each decision it changes an `Amended by ADR-NNNN` or
  `Superseded by ADR-NNNN` line. Edit a decision's body only to correct an
  error in what it recorded (ADR-0095).

## Writing tests

A test earns its place by going red when behaviour a user, operator or caller
relies on breaks, and staying green through a refactor.

- Test each rule at its **home**, the one module that owns it. A consumer gets
  one **wiring** test (passes the right input, shows the result). A change
  that moves a rule into a shared module takes its consumers' tests of it down
  to that one case.
- An integration test proves what only a running server can: routing and the
  API boundary, body limits and streaming, real D1 and R2, state across
  requests, and one wiring pass per feature. A rule's branches stay at its home.
- A test that mounts nothing and uses no Nuxt import belongs in `test/unit`,
  where it costs no Nuxt boot.
- Drive real code through a public seam and fake only the boundary: network,
  Ably, clock, object storage. Persistence runs on `createSqliteD1Harness` with
  the real migrations.
- Assert outcomes: stored rows, returned values, emitted events, visible text,
  ARIA state. Call arguments are the assertion only at a port whose call is the
  contract.
- Glue, pass-through repositories, re-exports and field-copy mappers are
  covered by the test of what they wire.
- A schema test names a rule the schema adds (refinement, transform,
  back-compat, cross-path parity) and covers both sides of each bound it tests.
  Literals, defaults, option lists and return shapes belong to the type system.
- Expose component state through ARIA or `data-*` and assert that, plus message
  codes and key tokens.
- Assert an optimistic update while its request is pending
  (`packages/nuxt-layer/test/helpers/deferred.ts`).
- Write cases as `it.each` tables in which every row can fail alone: it reaches
  a branch, bound or declaration no other row does. A table generated from a
  catalogue (every Screen Mode, field or token) gets a row per distinct branch,
  not a row per member. Build setup from the kits in `test/helpers/`
  and `test/nuxt/helpers/` (Nuxt UI stubs, graphics fixtures, realtime fakes),
  extending a kit when it lacks something.
- Test comments state the invariant in at most three lines; issue history
  belongs in the commit and PR.
- An invariant that resists a behavioural test goes, in order, to a type, a
  rule Oxlint already has (`.oxlintrc.json`), a parsed config, or an
  off-the-shelf linter.

Models: `test/unit/server/api/cardExpiry.sqlite.test.ts`,
`test/nuxt/stores/broadcastGraphicsLiveSessionProtocol.test.ts`,
`test/nuxt/components/Screen/Modes/settingsEditorFields.test.ts`.
