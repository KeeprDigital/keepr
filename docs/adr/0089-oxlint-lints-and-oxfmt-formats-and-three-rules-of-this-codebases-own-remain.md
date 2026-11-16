# ADR-0089: Oxlint lints and Oxfmt formats, and three rules of this codebase's own remain

Accepted · 2026-11-15. Changes ADR-0039, ADR-0079 and ADR-0082 where each named an ESLint rule. · Amended by ADR-0092: two more rules apply to `packages/`: an export states its types, and no focused or skipped test is committed

### Decision

**Oxlint lints the repository** (`.oxlintrc.json`): its `correctness` rules for JavaScript, TypeScript and a component's `<script>`, with type information wherever a tsconfig covers the file. ESLint is gone, and with it the antfu preset, the Nuxt ESLint module, the Drizzle plugin, every stylistic rule, and the linting and formatting of Markdown, CSS and SVG.

**Three rules of this codebase's own remain**, each for a defect no test sees:

| Rule                                               | Where                                    | The defect                                                                                                 |
| -------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `typescript/no-floating-promises`                  | the app's, the server's and shared `.ts` | on Workers a promise a handler never awaited is cut off once the response has gone (ADR-0082)              |
| no `crypto.subtle` and no `crypto.randomUUID`      | `app/` and `shared/`                     | a page opened over plain HTTP on a LAN address has neither (README § Local auth bypass)                    |
| no `eventRealtimeChannel`, imported or auto-import | rendering code                           | a rendering of a Screen follows its Screen's own channel, through `app/modules/screen/renderingChannel.ts` |

**The rules that were AST selectors are not carried over.** Oxlint has no rule that takes a selector, and it does not read a component's template. What those rules held is now convention, stated where it was decided:

- the test conventions of AGENTS.md § Writing tests: no assertion on a Tailwind class, no optional `$emit`, no conditional `expect`, no mock of Drizzle or of the module's own services, no timeout written on one test, real timers restored;
- a rendering reads its page size from its mode data, and mode data takes its Screen context as an argument (ADR-0039);
- an inspector or Theme field takes the shared number field (ADR-0079);
- the compositor's panels commit the stack through `useCompositorEditing` alone;
- a non-500 5xx names a cause the error mapper classifies;
- the Screen Mode Sample Dataset is a Theme preview's alone;
- a Drizzle `delete` or `update` names its rows.

**Oxfmt formats the code** (`.oxfmtrc.json`): tabs, semicolons and single quotes, as the code already was, and Oxfmt's defaults for everything else. `pnpm lint` fails on a file that is not formatted, and `pnpm lint:fix` formats. Markdown is left as written, and so is the silent-video validator Worker: its deploy fingerprint hashes its bundle byte for byte, so reformatting it would redeploy it (`scripts/deploy-promotion.mjs`).

**The server's program holds the Worker's generated types.** `nuxt.config.ts` adds `worker-configuration.d.ts` to it (`nitro.typescript.tsConfig`), so the floating-promise rule sees the promise a D1, R2 or KV binding returns rather than `any`.

**`pnpm verify:quick` lints everything.** A whole lint is ten seconds, so the script that linted only a branch's changed files is gone.

### Why

- **The repository is becoming one app of several in a monorepo.** A lint configuration of four hundred lines, most of it this app's architecture written as selectors, is one every other app would have to restate or do without. What is shared has to be small.
- **Cost.** A cold ESLint run was 39 to 60 seconds and 3.5 GB, enough that quick linted only changed files and CI was the backstop for the rest. Oxlint reads all 2,500 files, type-aware rules included, in 9 seconds (31 s of CPU, about 3 GB), measured on the 10-core, 16 GB machine in November 2026.
- **Most code here is written by agents**, against AGENTS.md and these decisions. The selector rules repeated in a second place what those already say.
- **The style is the one the code had.** Formatting with tabs and semicolons kept changed about a fifth of the lines; two spaces and no semicolons would have changed more than four in five.

### Consequences

- A component's `<script>` is linted without type information, and its template not at all. `vue-tsc` typechecks both, as before.
- Tests and scripts are linted without type information: no tsconfig the linter finds covers them, so the type-aware rules are off there (`.oxlintrc.json` says which).
- Three rules of the `correctness` category are off for what they misread here: a Zod schema's bound `parse` passed as a callback, an awaited Drizzle statement, and a copy taken before a loop that changes what it walks.
- Nothing mechanical holds the conventions listed above. A change that breaks one is caught by a test where one exists, and by review otherwise.
- Markdown is not linted or formatted. `pnpm verify:docs` is the documentation link test alone.
- Oxfmt is a beta (0.78), pinned exactly: a new version can format differently, so a bump is a commit that reformats. It needed a second pass to settle five files of the first reformat. A commit that reformats is listed in `.git-blame-ignore-revs`, so blame reads past it to the commit that wrote the line.

### Rejected alternatives

- **Porting the selector rules to Oxlint's JavaScript plugins.** The plugin API is alpha, it reaches no template, and each rule would be one this repository maintains.
- **ESLint kept for templates and selectors, beside Oxlint.** Two linters, two configurations, and the slow one still in every run.
- **Vite+ as the entry point** (`vp check`). It asks for its own build of Vite across the whole workspace, and a Nuxt app builds with Nuxt's.
