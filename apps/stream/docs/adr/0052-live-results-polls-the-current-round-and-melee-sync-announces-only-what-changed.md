# ADR-0052: Live Results polls the Current Round, and Melee Sync announces only what changed

Accepted · 2026-10-27

### Decision

**Live Results is a per-Event setting under which Melee Sync polls Melee.gg.** It is off by default, existing Events included, and can be on only while Melee Sync is on; turning Melee Sync off turns it off, so re-enabling sync starts without it. Turning it on starts a fresh poll (due now, no backoff, no error or stop reason, the idle clock restarted); turning it off stops polling and touches no data. `PUT /api/events/:id/melee/live-results` sets it; `GET` on the same path answers the Current Round and the last poll's state for the Sync page.

**The Current Round is derived, never set.** It is the latest Melee-managed Round (`isMeleeManagedRound`), in the Event's Round order, with at least one Match stored from Melee. A Round is complete when every such Match has a result or is a bye, or when the next Melee-managed Round has pairings. While the Current Round is incomplete, a tick fetches its Matches only (one paginated request) and syncs them; when they or the Round's standings name a participant the Event holds no Player for, one Melee added after pairing, the tick refreshes Players once and syncs the Round again (#1027). Once it is complete, a tick probes the next Round; when Melee pairs it, the tick refreshes Players once, so new Players resolve, and syncs it, which makes it current. With no Round paired, the first is probed; with no next Round, polling idles until a structure sync adds one (`liveResults/currentRound.ts`).

**Round Standings are stored only for a complete Round, on every Melee Sync path**: polling, Update from Melee, per-Round Refresh and Re-sync Matches. A sync of an incomplete Round stores its Matches and leaves its standings alone, without asking Melee for them. Pairing Round N+1 completes Round N, so that sync fills Round N's standings if none are stored. A manual sync of Round N+1 tries that fill every time, so it heals one that failed; Live Results tries it only with Round N+1's first pairings, so a Round N Melee has no standings for is not re-fetched every minute (`syncRoundMatches`' `previousRoundStandings` option). The Standings Screen therefore always shows standings after the last complete Round. A Match side's Player record follows the same rule: the Round's own fetched Round Standings once it is complete, and while it is played the previous Melee-managed Round's stored Round Standings, the record going into the Round, or none when that Round holds none.

**The Round snapshot write diffs, and each kind of change is announced on its own.** `meleeRoundSnapshotService().replace` writes only rows that changed and reports what did. `syncRoundMatches` publishes `melee:matchResultsSynced` (changed `matchIds`), `melee:pairingsSynced` and `melee:roundStandingsSynced`, each only when its content changed, for manual syncs too; a quiet sync publishes nothing.

**A one-minute Cloudflare cron is the scheduler.** `wrangler.jsonc` declares `* * * * *` beside the hourly `17 * * * *`, and every `cloudflare:scheduled` handler checks `controller.cron` against `server/utils/cronSchedules.ts`, so the graphics jobs stay hourly. `runDueLiveResultsTicks` ticks Events with Melee Sync and Live Results on whose `meleeLiveResultsNextCheckAt` is unset or passed, longest-waiting first, at most 25 per run, one at a time, each in its own `try`/`catch`.

**Local launchers fire the same cron themselves.** No local runtime fires a cron trigger, so under `pnpm dev`, `dev:local` and their `:bypass` variants Live Results never ticked and an operator saw "Not checked yet" for good (#887). The dev server fires the Worker's own `cloudflare:scheduled` hook with `* * * * *` in-process (`liveResults/localSchedule.ts`, started by the Live Results cron plugin only when `import.meta.dev`), and `pnpm preview` fires it through Wrangler's `/__scheduled` test route (`scripts/preview-worker.mjs`). Both fire at start and then each minute, skipping a minute while the previous firing is still running (`server/utils/localCron.ts`). Under `pnpm dev` a firing lasts the whole run; Wrangler answers `/__scheduled` once the handler has handed the run to `waitUntil`, so under `pnpm preview`, as under Cloudflare's own cron, a run longer than a minute can overlap the next, and the Melee Sync lease keeps one Event's ticks apart. They fire the entry the cron does, so the runner, the lease and each Event's next check decide what ticks, exactly as deployed. A deployed Worker never starts the local schedule: its real cron would tick every Event twice, and `pnpm worker:smoke` proves the built Worker ticks only when its cron fires.

**Poll state is columns on `events`**: next check, backoff step, last checked, last change, Live Results error, stop reason. Cadence is `nextLiveResultsSchedule`: results every minute, every five minutes after thirty quiet minutes, back to every minute on a change; probing, idling and failures back off from a minute, doubling to a fifteen-minute cap. Live Results stops itself, storing a stop reason, after twelve hours with no change of any kind (failed ticks count) or on a Melee 401/403.

**The Melee Sync lease keeps a tick from writing after Melee Sync is turned off, and never blocks an operator.** A tick takes the Event's lease as `live-results` for two minutes or skips; it never waits. Any operator command, configuration included, takes a `live-results` lease over at once in the same conditional `UPDATE` that takes a free one; only another operator command's lease answers `409`. Just before each Player or Round write the tick renews its lease by token and re-reads that Melee Sync and Live Results are both on, abandoning that write and every later one, its poll state included, when either check fails. Its poll-state write is itself conditioned on the lease token and both settings, so a reset that took the lease over always wins.

**A tick churns no Event row.** It writes only its poll columns, and publishes `event:updated` only when its Live Results error appears or clears or it stops itself. The Live Results error is its own column, apart from the manual sync's `lastSyncError`, so neither clears the other. Melee Sync takes a `MeleeSyncContext` (an optional origin connection id) instead of an `H3Event`, so a tick runs with no request.

### Why

Match Results reported on Melee.gg reached Stream Keepr only when an operator pressed a button. Polling closes that gap without operator action, and deriving the Current Round from synced data means no pointer can go stale.

Polling with the old messages would have made every results-reading Screen re-read every minute: every Round sync published `melee:roundSynced` whether or not anything changed, and every command rewrote and announced the Event row. Diffing and per-kind messages make a quiet tick invisible.

Melee's Round Standings for Round N include Round N's results, so storing them mid-Round would move the Standings Screen while the Round is played. Storing them on completion keeps "standings after Round X" honest.

A minute cron meets the cadence: the shortest interval is a minute, and backoff only needs a stored next-check time. It keeps all state in D1 beside the Event, with no new binding to deploy.

### Consequences

- A deploy without the minute cron silently stops Live Results; Events keep their setting and resume on the next deploy with it.
- Live Results polls Melee.gg from any running local launcher with an Event's Live Results on, as production does. Turning it off on the Sync page stops that.
- Every new `cloudflare:scheduled` handler must check its own cron, or it runs every minute. `test/unit/server/utils/cronSchedules.test.ts` pins the triggers against `wrangler.jsonc` and each handler's gate.
- A result corrected on Melee after its Round is complete is not polled for; a manual sync picks it up.
- Polling refreshes Players only when a new Round is first paired or the Current Round names a participant with no Player, never Deck Lists or Event structure.
- An operator command taken over a tick can overlap only the write the tick had already begun when it lost the lease: one Round snapshot or Player reconcile, which is itself a Melee Sync write of the same data. The tick's poll-state write is then refused by the token condition.
- `melee:roundSynced` is gone in the same release, with no compatibility window: a Screen Output still on the previous bundle during a deploy misses Round sync messages until it reloads.
- `test/unit/server/modules/meleeLiveResults.sqlite.test.ts` pins the tick, the runner and the status route; `meleeLiveResultsRules.test.ts` the cadence; `meleeLiveResultsCurrentRound.sqlite.test.ts` the Current Round; `meleeLiveResultsLocalSchedule.sqlite.test.ts` the local schedule and its dev gate; `test/unit/server/utils/localCron.test.ts` its cadence and overlap rule; `test/unit/scripts/previewWorker.test.ts` the preview launcher.

### Rejected alternatives

- **A Durable Object alarm per Event.** Exact per-Event timing, but a new binding and state outside D1, for a cadence a minute cron already meets.
- **An operator pointer to the Current Round.** It goes stale the moment Melee pairs the next Round, which is what polling exists to notice.
- **Store Round Standings whenever Melee returns them.** The Standings Screen would change mid-Round, and Seeds would read standings that still move.
- **Keep `melee:roundSynced` as the only message, published only on change.** Standings would still re-read on every reported result, and the Pairings Screen could not tell a result from a re-pairing.
- **Let a tick wait for the lease like an operator command.** A tick that waits holds a cron invocation for nothing; the next minute's tick tries again.
- **Let an operator command wait out a tick.** A tick slower than the wait still answers the operator `409`, and every wait delays the operator for polling, which Live Results must never do.
- **Leave local launchers without a scheduler, firing `/__scheduled` by hand.** Live Results is meant to just work wherever an operator runs the app, and a forgotten manual step looks exactly like #887.
