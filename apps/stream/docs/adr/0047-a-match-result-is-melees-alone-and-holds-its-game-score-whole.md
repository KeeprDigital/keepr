# ADR-0047: A Match Result is Melee's alone, and holds its Game Score whole

Accepted · 2026-10-26 · Amended by ADR-0083: migration `0001_since_v1_5_0` is gone, squashed into `0000_baseline_2`

### Decision

**Only Melee Sync writes a Match Result.** `hasResult`, `player1GameWins`, `player2GameWins`, `gameDraws` and `isBye` are Melee-owned in `PROVENANCE_ENTITIES`, and the Match create and update schemas refuse them, so a manual Match write carrying one answers `400`. The Matches page's result modal is gone. A manual Match, including one ADR-0040 keeps, is a pairing with no result.

**Melee Sync stores a whole Game Score.** Melee sends a side's `GameWins`, and a Match's `GameDraws`, as `null` rather than `0` when there were none: a 2–0 arrives as `2` and `null`. `mapMeleeMatchToDbRow` reads such a `null` as `0` on a reported Match that is not a bye, and stores no game wins or game draws for an unreported Match or a bye, whatever Melee sends. So every reported Match that is not a bye holds both sides' game wins and its game draws, and a reader can trust `hasResult`.

**Melee's `ResultString` is no longer kept.** It is English from player 1's side ("Kim Fields won 2-0-0") that no Player-side reading can turn round, and it existed only as the fallback for a reported Match without game wins, which no longer occurs. Migration `0001_since_v1_5_0` drops `matches.result_string`. Player history, Pairings, Head-to-Head and Top Cut Bracket read the Game Score; the stored `match.result` Graphic binding keeps its id and resolves the Game Score from player 1's side.

**No stored Match needs bringing to that shape.** A migration once did it: it cleared every result on a Match not from Melee, gave a reported Melee Match its missing zeros, and removed game wins and game draws from unreported Matches and byes. The second squash removed it along with every database holding such a Match (ADR-0083).

### Why

A reported 2–0 read as pending. `readMatchFromPlayerSide` needs both sides' game wins to name a winner, so in a local Event about a third of reported Matches showed "Pending" in a Player's history beside Melee's "won 2-0-0" text in the Result column; Head-to-Head called them `reported` with no winner, and Top Cut Bracket advanced no one. Normalising where Melee's payload enters fixes every reader at once.

Manual results were never meant to exist. A result entered by hand reached Player history, Pairings, Head-to-Head and Top Cut Bracket advancement while Melee's standings, which set every Player's record, never counted it, so the two disagreed.

### Consequences

- Results operators entered on manual Matches under v1.5.0 are gone with the database that held them (ADR-0083).
- Melee's `HasResult` stays the authority on whether a Match is reported. A Match Melee sends with `HasResult: false` and game draws (seen once locally, as "0-0-1 Draw") is unreported until Melee reports it.
- `HeadToHeadOutcome` loses `reported` and an earlier Match's `gameScore` is never `null`.
- `test/unit/server/mappers/meleeMappings.test.ts` pins the mapping and `test/integration/matches.test.ts` the refused manual writes.

### Rejected alternatives

- **Treat a `null` as `0` in each reader.** Player history, Pairings, Head-to-Head, Top Cut Bracket and the Graphic binding would each need the rule, and the next reader would miss it.
- **Keep manual result entry for manual Matches.** Melee's standings would still never count those results, so a Player's record and their history would keep disagreeing.
- **Keep `ResultString` for display.** It cannot be read from the second Player's side, and with a whole Game Score nothing needs it.
