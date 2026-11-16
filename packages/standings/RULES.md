# Standings rules

What the Standings Engine promises its callers, and exactly how it turns Results into Score, Tiebreakers and Rank. This is the exact definition. The reasons are in `docs/adr`; words are defined in `apps/score/GLOSSARY.md`, from the repository's root.

Every number here is exact. Fractions are kept as fractions and never rounded.

## The calls

- `computeStandings` works out Standings for the Phases before a Top Cut, and `finalPlacings` works out Final Placings once a Top Cut is under way or over.
- Each reads no clock, does no I/O and takes no Consumer code. The same input gives the same result at the same engine version.
- None throws. Invalid input comes back as `ok: false` with every error found and no rows. A failure inside the engine comes back as the error `internal-error`.
- Every success carries the engine version.

## What the engine is given

- Every Entrant, each with an id and, optionally, a Status: dropped, or removed. Every Entrant given gets a row, with or without Results, unless removed.
- The Results, as one list. A Result has two Entrants and an Outcome for each side, optionally with games won by each side and games drawn, and Extra Scores per side. Or it has one Entrant and is a Bye assigned by pairing (`bye`), an Awarded Bye (`awarded-bye`) or an Unplayed Loss (`unplayed-loss`).
- The Configuration is data: a points method, how a Bye and an Unplayed Loss count, the allowed Outcomes, the Tiebreakers in order, and how Byes received are counted. Every setting is stated. Nothing is assumed.
- Each call works out the whole tournament from the Results it is given, and nothing is kept between calls. Standings as of round 4 is a call with the Results of rounds 1 to 4. A corrected Result means calling again. A Pairing with no Result yet is simply absent.
- Planned rounds, needed only by a rate that counts `planned` rounds, and a Random Seed, needed only by the `random` Tiebreaker.
- Every Entrant given is ranked in one field. Tiebreakers count every opponent faced, whoever they are.
- The order of the Entrants and of the Results never changes the result. The order of the Tiebreakers is their priority.

## Outcomes

The two sides of a Result are a win and a loss, a draw and a draw, or a loss and a loss. A draw needs `allow.draws`, and both sides losing needs `allow.doubleLosses`.

## Input errors

Every error found comes back, each with a code, a sentence for a person and the Entrants involved, in an order the input's order does not change. For `computeStandings`:

| Code | When |
|---|---|
| `missing-configuration` | The Configuration is left out. |
| `missing-setting` | The Configuration, or an entry in it, leaves out one of its settings. |
| `unknown-tiebreaker` | A Tiebreaker the table below does not hold. |
| `unknown-field` | A field the engine does not know, at any level. |
| `duplicate-id` | Two Entrants have one id. |
| `unknown-entrant` | A Result names someone who is not an Entrant. |
| `two-results-in-round` | An Entrant has more than one Result in a round. |
| `impossible-outcomes` | The two sides of a Result are not one of the pairs in § Outcomes. |
| `disallowed-outcome` | A draw, or both sides losing, that the Configuration does not allow. |
| `missing-games` | A Result with two Entrants has no game scores, and the points method is `by-game-score` or a Tiebreaker is `game-win-rate`, `opponents-game-win-rate` or `game-wins`. |
| `missing-extra-score` | A Result with two Entrants lacks an Extra Score that the points method or an `extra-score-total` Tiebreaker names. |
| `unlisted-game-score` | A game score the `by-game-score` table does not list. |
| `missing-planned-rounds` | A rate counts `planned` rounds and no planned rounds are given. |
| `missing-random-seed` | The `random` Tiebreaker is chosen and no Random Seed is given. |
| `invalid-input` | Any other malformed input, such as a round below 1, a Result naming one Entrant twice, or `points.bands` that do not rise. |

For `finalPlacings`: `duplicate-id`, `unknown-field`, `unknown-entrant` (in the Top Cut but not an Entrant), `shared-rank` (§ Final Placings), `unknown-pairing` and `duplicate-winner` (a winner given for a Pairing the structure does not hold, or twice), `invalid-winner` (a winner not known to be in that Pairing), and `invalid-input` for anything else malformed.

## What a Result adds

**A Result with two Entrants.** For each side:

- Score goes up by the points the Configuration's points method gives that side.
- The round counts as played.
- The record gains a win, a loss or a draw, by the side's Outcome.
- The other Entrant is added to "opponents faced", however the Result ended.
- Game scores and Extra Scores are added up when given.

**A Bye**, assigned or awarded:

- Score goes up by the Configuration's Bye points.
- The record gains a win.
- If the Configuration says a Bye counts as played, the round counts as played and won, and its stated game score is added. If not, the round is left out of every rate.

**An Unplayed Loss**:

- Score goes up by the Configuration's points for it.
- The record gains a loss.
- If the Configuration says an Unplayed Loss counts as played, the round counts as played and lost, and its stated game score is added. If not, the round is left out of every rate.

## Points methods

| Method | A side earns |
|---|---|
| `by-outcome` | the stated value for its win, draw or loss |
| `by-game-score` | the value listed for its own games won, lost and drawn. A game score that is not listed is an input error |
| `by-extra-score-difference` | found from how far apart the two sides are on an Extra Score. The first band whose `upTo` is not below the difference applies. The side that is ahead, or level, gets `higher`; the other gets `lower` |
| `by-extra-score` | its own Extra Score |

## Tiebreakers

Higher is better unless stated.

**Match win rate** of an Entrant, under a rate's settings:

1. Rounds counted: with `played`, the rounds that count as played. With `planned`, the planned rounds less any of the Entrant's rounds that do not count as played; but for a dropped Entrant, the rounds that count as played.
2. With `wins`: wins in rounds that count as played, over the rounds counted. A draw earns nothing.
   With `points`: points earned in rounds that count as played, over `perRound` times the rounds counted.
3. With no rounds counted, the rate is zero.
4. If there is a floor and the rate is below it, the floor is used.
5. If the Entrant has dropped and there is a cap, and the rate is above it, the cap is used.

| Tiebreaker | Value |
|---|---|
| `match-win-rate` | the Entrant's own match win rate |
| `opponents-match-win-rate` | the average of the match win rate of each opponent faced |
| `opponents-opponents-match-win-rate` | the average of the line above for each opponent faced |
| `game-win-rate` | (`win` × games won + `draw` × games drawn) over (`win` × games played), in rounds that count as played. Zero with no games. Then the floor |
| `opponents-game-win-rate` | the average of the game win rate of each opponent faced |
| `loss-rate` | losses over rounds, both in rounds that count as played. Zero with no rounds. **Lower is better** |
| `opponents-loss-rate` | the average of the loss rate of each opponent faced. **Lower is better** |
| `wins` | wins in Results with two Entrants, plus Byes when `includeByes` is set |
| `game-wins` | games won in Results with two Entrants, plus the Bye's games won for each Bye when `includeByes` is set |
| `extra-score-total` | an Extra Score added up: scored `for`, scored `against` (**lower is better**), or the `difference` |
| `later-losses` | the round number of each loss, squared, added up |

Each value is returned twice: exact, as a fraction in lowest terms, and as a plain number for display only.

Averages over opponents:

- An opponent counts once per meeting, so one faced twice counts twice.
- A removed opponent still counts.
- An Entrant who has faced nobody gets the stated `withNoOpponents` value.

Two Tiebreakers are not a number per Entrant:

- **`head-to-head`** applies only where exactly two Entrants are level at that point. The one who has beaten the other more often than they have lost ranks higher. Otherwise it says nothing. Its value is 1 for the one ranked higher, 0 for the other, and `null` where it says nothing.
- **`random`** gives each Entrant a distinct whole number: the first 32 bits of the SHA-256 of `"tiebreaker"`, the Random Seed, the Entrant's id and an attempt number, moving on to the next attempt on a clash. Lower ranks higher. It does not depend on the round, so it never changes between recalculations. Its value is that number.

## Rank

1. Entrants are ordered by Score, highest first.
2. Each Tiebreaker in turn separates Entrants who are still level.
3. Entrants level on everything share a Rank. The next Rank skips ahead: 1, 2, 2, 4. `random` separates everyone still level, so placed last it makes every Rank different.
4. Removed Entrants are left out. Their Results still count for everyone they played.
5. Rows that share a Rank are listed in order of id.

## Byes received

The count the Pairing Engine uses for its Bye cap. It is the assigned Byes, plus the awarded ones when the Configuration says `assigned-and-awarded`. Each row also gives the assigned and the awarded counts on their own.

## Final Placings

- The input is every Entrant with their Rank from the Phases before the Top Cut, the Single Elimination structure as it was built, and the winner of each Pairing decided so far.
- A Rank shared by two Entrants in the Top Cut is an input error.
- The winner of the last Pairing is placed first.
- The losers of a round are placed directly below everyone who got past it, in Rank order among themselves. They are placed only once every Pairing in that round has a winner.
- An Entrant in the Top Cut who has not lost, while the Top Cut is unfinished, is marked "still in" and not placed.
- Everyone outside the Top Cut follows: its size, plus one, plus how many outside it have a strictly better Rank. Those who share a Rank share a placing.

## Starting Configuration

`startingConfiguration`, in `src/starting.ts`, is a Configuration to pass in or adapt. It is not a Preset, and the engine never applies it on its own. It needs match Outcomes only, no game scores, and has no `random` Tiebreaker, so Entrants level on everything share a Rank.

## Presets

Each reproduces one dated rules document. It takes the points and the Tiebreaker order from that document, and lists in its `assumptions` every setting the document leaves open, with the choice made. They are in `src/presets.ts`:

- `magic-2026-02-27`: Magic: The Gathering Tournament Rules, section 3.1 and Appendix C.
- `pokemon-2026-09-01`: Play! Pokémon Tournament Rules Handbook, sections 5.3.3.1, 5.5.2.1 and 5.6.1.

The worked examples in both documents are reproduced in `test/presets.test.ts`.

A Preset never changes. A publisher's new rules get a new Preset beside the old one, and none is removed.

The engine applies no Preset on its own. The Consumer passes the chosen Preset's Configuration and stores which Preset a Tournament uses.
