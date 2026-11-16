# ADR-0076: A clock that counts up after running out may hold at an operator-set limit, and a Round Clock may count up too

Accepted · 2026-11-06 · Amends ADR-0066

Productions want to show how far past time a Match or Round has run, but only for a set stretch (the end-of-round window, say), after which a clock still climbing on air is noise. A Feature Match Session Clock could already count up after its countdown, with no limit; a Round Clock held `0:00`.

### Decision

**Both clocks share one rule: counting up after running out is opt-in, and may hold at a limit in whole minutes (1 to 600), or count up without one.** `countUpOvertimeMs` (`shared/utils/clock.ts`) is the rule, with the bounds `COUNT_UP_LIMIT_MINUTES_MIN` and `COUNT_UP_LIMIT_MINUTES_MAX`. Both clocks stay clock projections: a held clock is a display, and nothing writes when it reaches its limit.

**A Feature Match Session Clock takes its limit from its Event.** `events.feature_match_default_count_up_limit` (minutes, `null` for no limit) sits beside the count-up toggle in the Event's Format Settings. As with the toggle, a Session's clock takes it when its state is created (`countUpLimitMs` on `ClockState`), so an edit applies to the next Match or a Match reset, not to a running one. A Match reset rebuilds the state from the Session's source snapshot, so an Event write naming any Feature Match default besides best of corrects every active Session's snapshot to the Event's defaults (`applyEventDefaults`, a `SnapshotCorrected` that leaves the state alone), and the Slots are announced. A state persisted before the limit existed carries none and counts up without limit. `projectFeatureMatchClock` applies it, so the operator clock, both Feature Match Screen Modes and the public Feature Match read all hold at the same value.

**A Round Clock counts up when its Screen says so.** `countUpAfterEnd` (off by default) and `countUpLimitMinutes` (unset for no limit) are Round Clock Screen config, set in the Clock card. `projectRoundClock` takes them, and after the end shows the time since the end, re-evaluating each second until it holds. The state stays `ended`, so its colour is the clock's colour after the end.

### Why

The limit is how long the production wants the overrun on air, which is a broadcast choice. A Round's timing is the floor's fact (ADR-0066), so the Round Clock's count-up belongs to the Screen that shows it, not to the Round. The Feature Match clock already took its count-up from the Event's defaults, and its limit follows it there.

### Consequences

- Two Round Clock Screens of one Round may differ: one holding `0:00`, one counting up.
- Changing an Event's limit leaves running Sessions on the limit they started with until a Match reset.
- Tests: `test/unit/shared/clock.test.ts` and `test/unit/shared/roundClock.test.ts` hold the rule on each clock; `test/unit/shared/featureMatchSessionReducer.test.ts` the limit a Match takes from its Event; `test/unit/server/services/featureMatchState.sqlite.test.ts` a new Session taking every stored default; `test/unit/server/services/featureMatch.sqlite.test.ts` a running clock keeping its limit while a Match reset takes the Event's; `test/unit/server/modules/eventWrite.sqlite.test.ts` which Event writes correct the Sessions; `test/unit/server/schemas/event.test.ts` the Event column's bounds; `test/nuxt/components/Event/ConfigCards.test.ts` and `test/nuxt/components/Screen/ModeSettings.test.ts` each setting; `test/nuxt/composables/screen/useRoundClockModeData.test.ts` the Screen setting reaching the projection.

### Rejected alternatives

- **The Round's own count-up setting, beside its start and duration.** It needs a migration and a Round write for what only a Screen shows, and would force every Screen of the Round to agree.
- **A per-Session limit an operator edits mid-Match.** The toggle has no such control today; an Event default covers the ask without a new Session command.
- **Hiding the clock at the limit.** Holding keeps the final overrun on air; a production that wants it gone switches the Screen.
