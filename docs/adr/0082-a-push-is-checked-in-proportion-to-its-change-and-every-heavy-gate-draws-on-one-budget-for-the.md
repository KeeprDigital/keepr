# ADR-0082: A push is checked in proportion to its change, and every heavy gate draws on one budget for the machine

Accepted · 2026-11-12

### Decision

**Before a push, `pnpm verify:quick` checks what the checkout changes since `main`, and CI checks everything.** Quick lints (everything, since ADR-0089 made that ten seconds), typechecks both programs, and runs the unit and Nuxt tests whose imports reach a changed file (Vitest's `--changed`, which runs every test when the change reaches a file every test depends on and none imports: `package.json`, a Vitest config or setup file, a migration). `--all` runs the whole cheap stage, as quick did before. CI stays the full gate on every ready PR and in the merge queue (ADR-0036); nothing it runs is narrowed.

**Every heavy gate takes run slots from one budget for the machine, shared by every worktree of the checkout** (`packages/tooling/scripts/slots.mjs`). A slot is about one busy core and 1.5 GB. The pool is two fewer than the cores, capped by memory: eight on a 10-core, 16 GB machine, three on a CI runner. Lint, each typecheck program and the build take three; a test run takes one per worker, to a ceiling two below the pool; the integration suite takes all of them. A gate with too few free waits in line, first come first served, and says who holds them. The ledger is one SQLite file in the Git common directory, the one place every worktree shares and can write. A gate started inside one that already holds slots (a script a test runs) takes none, since it would wait in line behind its own parent. A holder whose process is gone, or that has held slots for 30 minutes, gives them back. A ledger that cannot be read never blocks a gate: it runs unqueued and says so.

**CI's lint, typecheck, unit suite and Nuxt suite are four jobs, not one.**

**The floating-promise lint rule (`typescript/no-floating-promises`) is for the code a Worker runs.** There a floating promise is a defect no test sees: on Workers a promise a request handler never awaited can be cut off once the response has gone, and the write or publish is lost. In a component it is a click handler's, and the rule's yield was `void` written in front of it. Under ESLint the rule ran on server and shared code only, for its cost; since ADR-0089 it also reads the app's `.ts` files, and still no component.

### Why

Most work here is done by agents, several at once, each in its own worktree and none able to see the others. The gates were sized as if each run had the machine.

- **Memory.** A first `verify:quick` in a fresh worktree held about 10 GB at once: cold ESLint 3.8 GB (it builds the TypeScript program for one type-aware rule), a cold `vue-tsc` program 3.7 GB, the unit suite 2.4 GB. Two such runs are more than a 16 GB machine has, and agents ran 746 verification commands on one day (2026-11-10). That is the lock-up and the load flakes.
- **The rule nobody could follow.** "Run one integration suite at a time per machine" was an instruction to agents with no way to see each other. The pool enforces it.
- **More workers were slower.** Vitest starts one worker fewer than the cores. On the 10-core machine (four performance cores) the unit suite took 56 s at nine workers and 44 s at six; the Nuxt suite 113 s and 75 s. The ceiling is the faster setting, not a compromise.
- **Proportion.** A change to one shared utility reaches 16 unit files (3 s against 56 s for the suite); a change to one component reaches 38 Nuxt files (39 s against 113 s). Quick ran every test for every push, 216 times in three weeks, and CI then ran them again.
- **One rule was most of lint.** Linting everything with type information cost 176 s of CPU and 4.4 GB for a cold run, nearly all of it building the app's and the tests' TypeScript program. With the rule on server and shared code it is 60 s and 3.5 GB; without the rule at all, 46 s and 2.0 GB. Changed files outside server and shared then linted in under two seconds and half a gigabyte. (Oxlint, ADR-0089, lints the whole tree with type information in ten seconds, so quick no longer narrows lint.)
- **CI's wall time was one job.** Lint, typecheck and both suites ran in sequence for 11 to 18 minutes; every other job took 2 to 4.

### Consequences

- A test that reads a file without importing it (the documentation link test, the workflow and `package.json` wiring tests, route censuses) is not selected by a change to that file. CI catches it, a few minutes later than quick would have.
- Coverage floors are not checked by quick: a floor is over a whole suite. CI and `verify:quick --all` check them.
- A gate can wait. A wait prints `[run-slots] … has waited` every 15 seconds, and `pnpm slots` shows the line. A run started under a short tool timeout and killed while waiting has cost nothing; starting a second copy only lengthens the line.
- The pool covers the worktrees of one checkout. Another clone, or another project's suites, is outside it.
- The slot costs are measurements of this codebase in November 2026 (`RUN_SLOT_COSTS`). They are wrong when the codebase or the toolchain changes enough; re-measure rather than tune by feel.
- `apps/stream/test/unit/scripts/vitestRunSlots.test.ts` runs a real Vitest against a held pool. Holding a run to its slots rests on a plugin hook and on setting `maxWorkers` as the run starts, neither documented API; a Vitest bump that stops honouring either fails there.
- The integration suite waits for the whole pool, so it starts later on a busy machine and nothing starts beside it. `STREAM_KEEPR_RUN_SLOTS=off` runs unqueued, for reproducing a load failure on purpose.

### Rejected alternatives

- **A lock around `pnpm verify` only.** Agents start Vitest directly three times as often as they run verify, and those runs were the load.
- **A lower fixed worker count and nothing else.** It halves each run's appetite and leaves ten runs free to start at once.
- **Lock files or a pid directory for the ledger.** Taking a slot and reaping a dead holder's must be one atomic step, or two runs both reap and one takes a live holder's slot. SQLite's file lock gives that, and `node:sqlite` ships with the pinned Node.
- **The ledger in the temp directory.** Where that is depends on each session's environment (`TMPDIR`): two sessions given different ones would each see an empty pool. The Git common directory is the same for every worktree by construction.
- **Failing a gate that waits too long.** It fails exactly when the machine is busiest, and the agent's answer to a failed gate is to run it again.
- **Dropping `ts/no-floating-promises` altogether.** It would save a further 14 s of CPU and 1.5 GB on a cold lint, and give up the one check that stands between a forgotten `await` in a handler and a write lost in production.
- **Sharding the Nuxt suite in CI.** Its coverage floor is over the whole suite, so shards would need a merged report; the split already takes the wall time from the sum to the longest job.
