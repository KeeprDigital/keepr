# ADR-0123: A merge group with no Worker leg reuses a PR run that had none

Accepted · 2026-11-18 · seen on [#1273](https://github.com/KeeprDigital/keepr/pull/1273) · Amends ADR-0036 and ADR-0121 · Amended by ADR-0147: a merge group accepts a PR run's skipped job whenever its own run would skip that job too, the Worker job among them

### Decision

**A PR run of code that ships in no deployable app records its tree.** Such a change, for example to the tooling's tests or to a workflow other than `ci.yml`, runs every code gate and no Worker leg (ADR-0121), so the Worker job (`worker-guard`) is skipped. The `record` job now runs for it: its condition no longer needs a leg, and instead of the implicit `success()`, which a skipped job fails, it runs unless the run was cancelled or any job it waits on failed or was cancelled.

**A merge group reuses that run only if its own scope runs no Worker leg either.** ADR-0036 reuses a run in which every job ran and passed. One job may now be skipped instead: the Worker job, when its scope chose no leg. The scope (`packages/tooling/scripts/ci-scope.mjs`) measures the group first, then asks the reuse check (`packages/tooling/scripts/ci-reuse.mjs`) whether the group runs any leg. Only when it runs none does the check accept that skip. Every other job must still have passed, and a group with a leg refuses a run whose Worker job was skipped.

**The check knows the Worker job by its exact name.** When the scope names no app, the job's condition skips it before its matrix expands, so GitHub reports it under its name's template, `Build, wrangler dry runs, and Worker smoke (${{ matrix.app }})`. A leg that ran or was skipped is named after its app instead. `ci-reuse.mjs` holds that name as `NO_LEG_WORKER_JOB`, and `ciWorkflows.test.ts` holds it to `ci.yml`.

### Why

- **Tree equality already makes it safe.** The group's tree is the PR run's, so the run executed the group's own CI code. The group's scope then chose no leg, so its own run would skip the Worker job too. The PR run therefore left out nothing that the group's run would have checked.
- **The group's own legs, not the PR run's.** The two scopes can measure against different bases, so the group does not rely on the PR run's choice. It reads its own, which is what its run would do, and a scope that cannot tell what changed runs every leg and refuses the skip.
- **Otherwise CI runs twice on one tree.** Without this, every change that ships in no deployable app ran CI in full twice, as in #1273: once on the PR and again in the queue, though the tree was identical.

### Consequences

- A merge group now measures its diff before the reuse check. That adds a fetch of the queue's base to a reused run.
- The record no longer needs every job to have passed under the implicit `success()`. Its own conditions stop it for any failed or cancelled job, and the reuse check still reads GitHub's record of every job, so a wrongly recorded run costs only a full group run.
- Unit-tested without GitHub: the exception at its home (`packages/tooling/test/ciReuse.test.ts`), the scope's wiring of its legs into the check (`ciScope.test.ts`), and the record's condition and the Worker job's name (`ciWorkflows.test.ts`). That GitHub names a job with an empty matrix by its template is observed on #1273's run, not tested.

### Rejected alternatives

- **Accept any skipped job whose name starts with the Worker job's.** That would also accept one app's leg that was skipped, which is a leg the group may need.
- **Run a placeholder leg when the scope names no app.** A job that checks nothing, run only so that nothing is skipped, costs a runner on every such PR.
- **Trust the PR run's own scope output.** The group measures against the queue's base, which the PR run never saw, so only the group's own scope says what its run would skip.
