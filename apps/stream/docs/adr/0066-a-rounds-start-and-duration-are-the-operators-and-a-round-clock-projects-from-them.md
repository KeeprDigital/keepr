# ADR-0066: A Round's start and duration are the operator's, and a Round Clock projects from them

Accepted · 2026-11-04 · [#916](https://github.com/KeeprDigital/stream-keepr/issues/916). Records N1 b from [#783](https://github.com/KeeprDigital/stream-keepr/issues/783). Extends ADR-0040 and ADR-0046; follows ADR-0009 and ADR-0022 · Amended 2026-11-06 (ADR-0076): a Round Clock's Screen may count up after the end, to an optional limit · Amended by ADR-0049 (#1077): the Round Clock reads its surface, type and Round name's colour from Foundation Tokens directly, and keeps only its pending, running and ended clock colours as Mode Tokens

### Decision

**A Round gains an optional start and duration, entered by an operator.** `rounds.started_at` (a server timestamp) and `rounds.duration_minutes` (whole minutes, 1 to 600) hold them. Both are `manualWritable` in `PROVENANCE_ENTITIES`, so a Round edit (`PATCH …/rounds/:roundId`) accepts them, an ISO instant and a number, and `null` clears either. A new Round starts untimed: the create write refuses them. They ride the Round's response, so `round:updated` announces them.

**"Start now" sets the start to server time.** `POST …/rounds/:roundId/start` (`roundWriteModule().start`) writes the server's own clock as the start, so the operator's browser clock never sets it. The Event Structure page offers it on each Round row until the Round has started, then in the Round's menu, where it restarts the clock. The Round edit modal edits the start and duration, and sends either only when edited, so a save never undoes a "Start now" made while it was open.

**Melee Sync never writes either field, whether the Round is imported or manual.** Melee imports no timing, and neither its Round upsert (`upsertByExternalId`) nor its removal of imported structure (ADR-0040) names them, so an imported Round keeps its operator's timing through every sync, and through being kept as manual structure. Unlike ADR-0046, no edited-field list is needed: there is no Melee value to keep apart.

**The Round Clock Screen Mode shows a Round's time remaining as a clock projection.** `projectRoundClock` (`shared/utils/roundClock.ts`) is a pure function of the Round's start, its duration and server time: before the start, or with none, it shows the full duration, not running; after the end, `0:00`, or the time since the end where its Screen counts up (ADR-0076); with no duration, no clock. Every rendering evaluates it on the shared clock (`useServerTime`) and re-evaluates exactly when it next changes (a start further off than one timer can wait is waited for in steps), so renderings of the same Round agree, and nothing writes as it runs or when it runs out, as with Page Rotation (ADR-0009) and Card Timeout (ADR-0022). The display uses `formatCountdownTime` for the time remaining and `formatClockTime` for the full duration and the time since the end (ADR-0078).

**It shows the Current Round unless it picks a Round.** Its `roundId` is an Event Reference of kind `round` (ADR-0038), released when that Round is deleted (ADR-0060). Unset, its Screen Output read (`round-clock`) answers the Current Round (ADR-0052), so a Melee Event's clock follows the Event from Round to Round. Its data re-reads on its Round's `round:updated`, so "Start now" starts every output counting without a reload, and while following the Current Round, on any Round, Phase, Match or Melee pairing change that may move it.

**It is a plain overlay mode, Magic: The Gathering only.** It declares `offeredTo: TWO_PLAYER_MAGIC_ONLY` (a One Piece Card Game Event has no Rounds, ADR-0057), a Background Layer stack, and Mode Tokens defaulting to Foundation Tokens: its surface, the Round name's type and colour, and the clock's type and its colour running, before the start and after the end. A Theme preview shows it through the Screen Mode Sample Dataset's Round 8, not yet started, at 50:00.

### Why

Productions want an on-air clock of the time left in the Round, and Rounds stored no timing and Melee Sync imports none, so the operator enters it. A projection, rather than a ticking state an output persists, keeps every output in step without a writer and survives a realtime outage, the reasons ADR-0009 gives.

### Consequences

- The clock is only as right as the operator's entry. A Round started late on the floor is corrected by editing its start or pressing "Start now" again.
- A manual Event has no Current Round, so its Round Clock must pick a Round.
- The sample shows the clock before its start, so a Theme preview paints the clock's colour before the start, not its running or ended colours; the Theme token tests probe all three.
- Tests: `test/unit/shared/roundClock.test.ts` holds the projection on a fake clock; `test/unit/server/schemas/round.test.ts` the duration's bounds; `test/unit/server/modules/roundTiming.sqlite.test.ts` the Round writes, "Start now" and both Melee Sync paths; `test/unit/server/services/roundClock.sqlite.test.ts` which Round the read shows; `test/nuxt/composables/screen/useRoundClockModeData.test.ts` the ticking and re-reads.

### Rejected alternatives

- **Melee-imported Round timing.** Melee Sync imports none today, and #783 chose operator entry (N1 b).
- **The browser's clock stamps "Start now".** Two operators' browsers can disagree by seconds; the server's clock is the one every rendering already syncs to.
- **A timer state an operator pauses.** A pause is a Feature Match Session Clock's concern, not a Round's. Counting up past the end was rejected here too, as the ticket asked for `0:00`; ADR-0076 reopened it as a Screen setting, off by default.
