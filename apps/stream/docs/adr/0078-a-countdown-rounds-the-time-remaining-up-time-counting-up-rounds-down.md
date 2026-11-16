# ADR-0078: A countdown rounds the time remaining up; time counting up rounds down

Accepted · 2026-11-10 · Amends ADR-0066 and ADR-0076

Every clock showed whole seconds by rounding down. A 50:00 countdown so read `49:59` the instant it started and `0:00` through its whole last running second, and one that counts up after showed `0:00` for two seconds running (#1025).

### Decision

**A countdown shows the time remaining rounded up to the whole second; elapsed time and count-up time are rounded down, as before.** This holds for a Feature Match Session Clock and a Round Clock alike. `formatCountdownTime` (`shared/utils/clock.ts`) is the rule for time remaining, and `projectFeatureMatchClock` and `projectRoundClock` apply it, so the operator's clock, every Screen Output and the public Feature Match read agree. `formatClockTime` still rounds down, for a count-up clock, count-up time, the time since a Round's end, and a length of time such as a duration.

**A countdown's display changes as each whole second remaining is reached, its last at the end itself.** `countdownNextChangeInMs` names that moment for both clocks, so a rendering re-evaluates exactly then.

### Why

A clock should read its full duration when it starts and `0:00` when it ends. Rounded down, it never showed its full duration while running, and showed `0:00` with up to a second still to play. Time counting up has the opposite ends: it starts at `0:00` and should not show a second it has not yet reached, so it keeps rounding down.

### Consequences

- A clock that holds at its end reads `0:01` through its last second and `0:00` from the moment it runs out.
- A clock that counts up after reads `0:01`, then `0:00` for one second (the end through the first second past it), then `0:01` again counting up. At a count-up limit it holds from the moment it reaches the limit (ADR-0076), as before.
- A countdown stopped part-way through a second shows the second it is in: 4:59.6 remaining reads `5:00`.
- Adjusting a clock stays exact to the millisecond (`applyClockAdjustment`). A whole-second `+` or `−` moves what the clock shows by exactly that, across the end too, since count-up time is time remaining below zero and rounding it down is rounding the time remaining up. A set-to shows the time set through its first second.
- Tests: `test/unit/shared/clock.test.ts` and `test/unit/shared/roundClock.test.ts` hold the rule and each boundary; `test/nuxt/composables/featureMatch/useClockDisplay.test.ts`, `test/nuxt/composables/screen/useRoundClockModeData.test.ts` and `test/nuxt/components/FeatureMatch/State/EditStateModal.test.ts` that each rendering takes it.

### Rejected alternatives

- **Rounding to the nearest second.** The clock would read `0:00` with half a second left, and change digit half a second off every other clock.
- **Rounding count-up time up as well.** It would skip `0:00` and read `0:01` the instant after the end.
