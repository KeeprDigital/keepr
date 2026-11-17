# ADR-0088: Every clock projection runs on one scheduler

Accepted · 2026-11-14 · [#1194](https://github.com/KeeprDigital/stream-keepr/issues/1194). Follows ADR-0009, ADR-0022, ADR-0066, ADR-0076 and ADR-0078, and changes none of them. The scheduler is in ([#1195](https://github.com/KeeprDigital/stream-keepr/issues/1195)), and so is the eased time correction ([#1199](https://github.com/KeeprDigital/stream-keepr/issues/1199)); the last two readers timed on the device's clock moved onto it in [#1204](https://github.com/KeeprDigital/stream-keepr/issues/1204).

A Feature Match Session Clock's display, a Round Clock, Page Rotation, a Talent Screen's Social Profile Rotation and Card Timeout are each a clock projection: a pure function of stored state and server time. The rules were right, but each rendering timed its own re-evaluation, and the five had drifted. Two re-timed when server time re-synced and waited while it was unknown, one re-timed without waiting, and two did neither, so after a re-sync one output of a clock could change a beat off another.

### Decision

**One scheduler re-evaluates every clock projection.** `useClockProjection` (`packages/nuxt-layer/app/composables/core/useClockProjection.ts`) takes a pure function of server time that answers a value and how long until that value next changes, or that it will not change on its own, and returns the value reactively. It answers anew:

- exactly when the value next changes;
- when a reactive input the function reads changes;
- when the server time offset changes, and when server time first becomes known, even at an offset of zero.

A change further off than one timer can hold (2^31 − 1 ms) is waited for in steps. The wait ends with the scope that owns it. It runs on the client only; a server render takes the projection once.

**Each caller declares what its projection answers while server time is unknown.** The option is required, so a new clock projection cannot skip the question:

| Clock Projection                                          | While server time is unknown |
| --------------------------------------------------------- | ---------------------------- |
| Page Rotation                                             | its first page (ADR-0009)    |
| Social Profile Rotation on a Talent Screen                | its first profile            |
| Feature Match Session Clock display                       | the device's own time        |
| Feature Match Session Clock running out (starts overtime) | the device's own time        |
| Edit Match State clock field                              | the device's own time        |
| Round Clock                                               | the device's own time        |
| Card Timeout                                              | the device's own time        |

A projection on the device's own time is taken again the moment the first sync lands.

**No clock projection holds a timer of its own.** The rule of each stays where it was (`apps/stream/shared/modules/page-rotation`, `apps/stream/shared/modules/talent-screen`, `apps/stream/shared/utils/card/timeout.ts`, `apps/stream/shared/utils/roundClock.ts`, `apps/stream/shared/utils/clock.ts`); only what calls it, and when, moved. A Page Rotation's pages and a Social Profile Rotation's steps are counted on one interval rule (`packages/nuxt-layer/shared/utils/interval.ts`); what a step means stays with each.

**A sync trusts its tightest sample, and eases a small correction in.** `useServerTime` (`packages/nuxt-layer/app/composables/core/useServerTime.ts`) takes the offset of the sample with the shortest round trip, since a round trip bounds its sample's error to half of itself and an average only adds the looser samples' error. A sample over the round trip ceiling still counts only while no offset is held.

| Correction                                          | Applied                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------ |
| The first sync, whatever its size                   | at once                                                            |
| Larger than `STEP_CORRECTION_THRESHOLD_MS` (500 ms) | at once                                                            |
| Up to the threshold                                 | eased in at no more than `MAX_EASE_RATE` (a tenth) of elapsed time |

An eased correction is measured from the server time being read, so one that interrupts another carries on from where that one had reached. While it runs, server time advances at between nine and eleven tenths of the device's, and so never stops or moves backwards. `serverTimeOffset` is the offset synced to and changes once, when the sync lands; `getServerTime` answers with what has been eased in so far. `getServerTime` is reactive to the correction completing, so the scheduler, which reads it, answers again then as it does when the offset changes. A wait is for server time to reach the change, not the device's: `deviceDelayFor` answers how long that takes on the device under the correction being eased in, and the scheduler times its wait by it.

**A page coming back re-syncs at once.** Beside the fixed interval, a sync runs when the document becomes visible and when the browser reports it is back online, unless one is running or one completed within `RESYNC_MIN_GAP_MS` (5 s). A last sync dated in the device's future does not count as recent: the device's clock was set back.

**A device whose clock is changed re-syncs within seconds.** A visible, online tab gets no event when its device's clock is changed, so every second the device's clock is compared with its monotonic clock (`performance.now()`), each measured from when the sync that took the offset held began. Moved apart by more than `CLOCK_CHANGE_THRESHOLD_MS` (the step threshold, 500 ms), a sync runs under the same rule as a page coming back. The change stands until a sync answers it, so one the 5 s gap skips, or whose re-sync goes unanswered, is asked about again; an unanswered one no sooner than 5 s after the last sync began, so an unreachable server is not asked every second.

### Why

"Wake me when this next changes" is one rule, and getting it right needs the same four things every time: the next change, the inputs, the re-sync, and the unknown clock. Written once, a fix to any of them reaches every clock on air, and two outputs of one clock are held to the same behaviour by construction rather than by five sets of tests.

A correction applied as a step moves server time by its whole size between two reads. Back, and a digit already passed is shown a second time; forward, and one is skipped. Most corrections are a few tens of milliseconds of network jitter, well inside a second, so easing them costs nothing visible and removes the flicker. A clock out by more than half a second is wrong on air, and putting it right at once matters more than a smooth digit.

### Consequences

- A Feature Match Session Clock display and a held Screen Card now re-time when server time re-syncs, so a Card hides by the shared clock after a re-sync as every other holder does. A Round Clock now also re-evaluates on a first sync that leaves the offset at zero. Nothing else on air changes.
- Card Timeout is a projection of the held Card: whichever Card is held is timed, and none is timed while none is held. Nothing arms or cancels a timer by hand.
- A projection is answered again when its wait runs out, so a test that fakes server time must let it run with the timers it fakes. One frozen at an instant never reaches the change it waits for.
- The Broadcast Graphics playout clock and Graphic Animation timing are not clock projections of this kind and keep their own timing. Playout changes on every frame, so it is read on a frame clock (`useFrameClock`, `packages/nuxt-layer/app/composables/core/useFrameClock.ts`): server time read again each animation frame while anything is in motion, and no frame once all of it has settled. Every Broadcast Graphics surface's playout clock is one.
- A Feature Match Session Clock running out, which starts overtime, and the Edit Match State clock field read the clock's projection on server time, so neither disagrees with the clock display beside it on a device whose clock is off.
- While a correction is eased in, two outputs of one clock can differ by up to what is left of it, at most the threshold and for at most five seconds. Before, they differed by the whole correction until each next synced.
- A wait timed while a correction is eased in is as long on the device as server time takes to reach the change (`deviceDelayFor`), rounded up to the millisecond, so a change lands on its server instant during a correction as it does outside one. A fake of `useServerTime` that the scheduler runs on answers `deviceDelayFor` too; `packages/nuxt-layer/test/nuxt/helpers/serverTime.ts` is the one such fake.
- "Synced" still means an offset is held. A missed re-sync keeps the offset held, and a correction under way runs to its end.
- A device whose clock is changed by more than half a second is put right within a few seconds, or once the server answers; by less, at the next sync, eased in like any small correction ([#1203](https://github.com/KeeprDigital/stream-keepr/issues/1203)).
- The thresholds are starting values chosen so an eased correction completes within five seconds; tune them if an artefact shows on air.
- Tests: `packages/nuxt-layer/test/nuxt/composables/core/useServerTime.test.ts` holds the sync's rules. `packages/nuxt-layer/test/nuxt/composables/core/useClockProjection.test.ts` holds the scheduler's rules. Each consumer keeps one case that it passes its projection and shows the answer, in `apps/stream/test`: `useClockDisplay.test.ts`, `useRoundClockModeData.test.ts`, `screenModePagination.test.ts`, `useTalentModeData.test.ts` and `stores/card.test.ts`.

### Rejected alternatives

- **A free-running interval per rendering.** Two outputs of one clock change digit up to an interval apart, and each keeps waking with nothing to show.
- **One answer for every projection while server time is unknown.** A rotation on an unknown clock shows the wrong page beside an output that has synced, so it holds its first; a running clock that held would blank or freeze behind a slow time endpoint.
- **A scheduler per kind of clock.** The five differ in their rule, not in how they are timed.
- **Averaging the samples of a sync.** The mean of a tight sample and a loose one is worse than the tight one alone.
- **Easing every correction.** A clock a minute out would take ten minutes to come right.
- **Stepping only forwards, easing only backwards.** A forward step still skips a digit on one output of a clock and not on another.
