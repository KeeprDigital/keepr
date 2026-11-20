# Pairing rules

What the Pairing Engine promises its callers, and exactly how it decides which set of Pairings is best. This is the exact definition. The reasons are in `docs/adr`; words are defined in `apps/score/GLOSSARY.md`, from the repository's root.

## The calls

- `pairRound` pairs one Swiss round, `buildStructure` lays out a whole Single Elimination, and `checkPairings` describes Pairings made by hand.
- Each reads no clock, does no I/O and makes no random choice the Random Seed does not fix. The same input gives the same result at the same engine version.
- None throws. Invalid input comes back as `ok: false` with every error found and no Pairings. A failure inside the engine comes back as the error `internal-error`.
- Every result carries the engine version.

## What the engine is given

- For each present Entrant, finished facts only: its Score, the opponents it has faced, its Byes received, its Group Labels, and its Rank, which every Entrant needs when a Constraint uses Rank. The engine never sees Results, point values or Tiebreakers.
- The Consumer keeps the facts consistent. The engine refuses only what they show to be wrong: two Entrants with one id, an Entrant listing itself as an opponent, or a present Entrant listing another present Entrant as an opponent who does not list it back.
- An opponent or a listed pair that names an Entrant not present is ignored.
- The Configuration is data: Constraints from the tables below, in priority order, with their settings. A Constraint the tables do not hold is an input error. A Constraint not in the Configuration is not applied.
- A Configuration applies to the one call it comes with. No Constraint looks at the round number, so rules that change by round are a different Configuration in each call.
- The engine ships no Presets. It exports one Starting Configuration, `startingConfiguration`: `no-rematch`, `bye-cap` (max 1), `bye-to-lowest-score`, `pair-close-in-score`, `keep-top-clean`. It uses no Rank. The engine never applies it on its own: every call states its Configuration. It is frozen, so a caller adapts a copy.
- A Group Label's kind is any name. Only the kinds an Entrant is given count, so a kind named like a built-in property, such as `constructor`, is an ordinary name.
- The round number feeds Shuffle Positions and is echoed back. Nothing else depends on it.
- A work limit, when given, counts steps, never time.
- The order of the Entrants, of the opponents each lists and of the listed pairs never changes the result. The order of the Configuration is its priority.

## Input errors

Every error found comes back, each with a code, a sentence for a person and the Entrants involved, in an order the input's order does not change. For a Swiss round, in `pairRound` and `checkPairings`:

| Code | When |
|---|---|
| `duplicate-id` | Two Entrants have one id. |
| `self-opponent` | An Entrant lists itself as an opponent. |
| `one-sided-history` | A present Entrant lists another present Entrant as an opponent who does not list it back. |
| `missing-rank` | An Entrant has no Rank and a Constraint uses Rank: `bye-to-lowest-rank`, either pair-by-Rank Constraint, or `pair-down-choice` with `from` or `opponent` other than `random`. |
| `missing-configuration` | The Configuration is left out. |
| `unknown-constraint` | A Constraint the tables do not hold. |
| `missing-setting` | A Constraint leaves out one of its settings. Nothing is assumed. |
| `duplicate-constraint` | A Constraint appears twice. A Group Label Constraint may appear once per kind. |
| `unknown-field` | A field the engine does not know, at any level. |
| `too-many-entrants` | More Entrants than one call can hold (§ Limits today). |
| `invalid-input` | Any other malformed input, such as a Score outside its limits, a round number or `bye-cap` max below 1, or a pair to avoid naming one Entrant twice. |

## Best

Every set of Pairings gets one whole number per level. Lower is better. Sets are compared level by level, in order, and the first level that differs decides.

The levels are the Constraints of the Configuration in the order given, followed by Shuffle Positions.

Each level scores one Pairing, or the Bye, on its own. A set of Pairings scores the sum. No level looks at more than one Pairing at a time.

## Terms used below

- **present**: in this call.
- **gap** of a Pairing: the difference between its two Scores.
- **Pair-down**: a Pairing whose gap is not zero.
- **place** of an Entrant: how many present Entrants have a strictly better Rank. The best Rank has place 0. Entrants who share a Rank share a place.
- **N**: how many Entrants are present.

## Yes-or-no Constraints

Each scores 1 when broken and 0 otherwise. A broken one is reported as a Violation.

| Constraint | A Pairing scores 1 when | The Bye scores 1 when |
|---|---|---|
| `no-rematch` | either Entrant lists the other as an opponent | never |
| `bye-cap` (max) | never | the Entrant's Byes received are `max` or more |
| `avoid-same-group-label` (kind) | both have a Group Label of that kind and the values are equal | never |
| `avoid-listed-pairs` | the two are a listed pair, either way round | never |

## Measured Constraints

A measured Constraint is never reported as a Violation.

| Constraint | A Pairing scores | The Bye scores |
|---|---|---|
| `prefer-same-group-label` (kind) | 1 when both have a Group Label of that kind and the values differ | 0 |
| `bye-to-lowest-score` | 0 | the Entrant's Score minus the lowest present Score |
| `bye-to-lowest-rank` | 0 | how many present Entrants have a strictly worse Rank |
| `pair-close-in-score` | the gap squared | 0 |
| `keep-top-clean` | for a Pair-down: the higher Score minus the lowest present Score, plus 1 | 0 |
| `keep-bottom-clean` | for a Pair-down: the highest present Score minus the lower Score, plus 1 | 0 |
| `pair-adjacent-by-rank` | the difference between the two places, squared | 0 |
| `pair-top-vs-bottom-by-rank` | (the two places added together, minus N − 1), squared | 0 |

`pair-down-choice` (from, opponent) is two levels, in this order:

1. For a Pair-down, how far the Entrant with the higher Score is from being the one `from` asks for.
2. For a Pair-down, how far the Entrant with the lower Score is from being the one `opponent` asks for.

"How far" counts Entrants in the same Score Group: for `highest`, those with a strictly better Rank; for `lowest`, those with a strictly worse Rank; for `random`, always 0.

## Shuffle Positions

The last level, always.

- Each Entrant gets a whole number from 0 to 2²⁰ − 1: the first 20 bits of the SHA-256 of `"shuffle"`, the Random Seed, the round number, the Entrant's id and an attempt number starting at 0. Each part is written as its length in bytes then its UTF-8 bytes.
- Positions are made distinct. Entrants are taken in order of id; one whose position is already held tries the next attempt number.
- A Pairing scores the difference between the two positions, squared. The Bye scores the Entrant's position, squared.

With no Constraint in play this is "shuffle, then pair neighbours".

Among sets of Pairings the Constraints rate as equal, the choice is fixed by the Random Seed but is not a uniform pick: some come up more often than others.

A change to how Shuffle Positions are made is a major release.

## The result

- Every present Entrant appears exactly once: in a Pairing of two, or as the Bye. There is one Bye when N is odd and none when it is even. No Entrants gives an empty result, not an error; one Entrant gets the Bye.
- A valid input is never refused. When the Constraints cannot all be met, the Pairings come back with their Violations, each naming the Constraint and the Entrants affected.
- Each Pairing carries its gap. A gap above 0 marks a Pair-down.
- Within a Pairing: higher Score first, then better Rank when every Entrant has one, then lower Shuffle Position.
- Between Pairings: by the higher Score, then the lower Score, then the best Rank in the Pairing when every Entrant has one, then the lowest Shuffle Position in the Pairing.
- Violations are listed in Configuration order, and within one Constraint in the order of the Pairings, then the Bye.
- A result marked proven is a best set of Pairings as defined above, so each yes-or-no Constraint has the fewest Violations possible without scoring worse on a Constraint above it. It does not mean those particular Entrants had to be the ones.
- If the proof cannot be completed, or the work limit is hit, a simple pairing in Score order comes back instead, marked not proven. Its Violations are listed but are not claimed to be the fewest possible.
- The round number comes back as given.

## Checking hand-made Pairings

- `checkPairings` takes a Swiss round's input, the Pairings and Byes to check, and whether to compare them with the best. It never refuses a set and never changes one. Only an invalid round input, or Pairings and Byes that are not lists of ids, are errors.
- Coverage lists the present Entrants in no Pairing and no Bye, those appearing more than once, the ids that are not present Entrants, and how many Byes a complete set has: 1 when N is odd, otherwise 0. A half-finished set is described, not refused.
- The Pairings between present Entrants come back in the order given, each with the higher Score first and its gap.
- Violations are scored as in a pairing result, in Configuration order, and within one Constraint in the order of the Pairings given, then the Byes.
- The comparison comes back only when asked for and the coverage is clean: nothing missing, repeated or unknown, and the right number of Byes. It costs a full pairing run.
- The comparison gives, for each level in Configuration order, the score of the given set and of the best set. `pair-down-choice` gives two, marked `from` and `opponent`. Shuffle Positions are left out, so a hand-made set can be as good as the best.
- `asGoodAsBest` compares the two sets level by level, as § Best does: it is true when the given set is no worse. Against a best that is not proven a given set can be strictly better, and it is then as good as the best. It is exact even where the scores are too large to be exact numbers. `provenBest` is false when the best could not be proven.
- Checking a proven result against the input that made it finds the same Violations, and finds it as good as the best.

## Single Elimination

The whole structure comes back from one call. A Slot after the first round names the winner of an earlier Pairing by its number, and the Consumer fills in winners: the engine never sees a Result here either.

- Each Entrant brings an id and a Rank. Ranks must all differ; gaps are fine, only their order matters. No Configuration, Random Seed or history is used, so Entrants who have met before may meet again.
- Places follow Rank, so the two best can meet only in the final. For eight: 1v8 and 4v5 feed one semi-final, 2v7 and 3v6 the other.
- Any count from two up. When it is not a power of two, the best Ranks have no opponent in round one: they are listed as round one's Byes, best Rank first, and placed directly in round-two Slots.
- Pairings are numbered from 1 across the whole structure, round by round.
- There is no third-place Pairing, and never a Violation.
- Errors: `shared-rank`, `duplicate-id`, `unknown-field`, `too-few-entrants` (fewer than two, when nothing else is wrong), and `invalid-input` for anything else malformed, a missing Rank included.

## Limits today

- A Score must be a whole number from −1,000,000 to 1,000,000.
- One call can hold at most 262,144 Entrants, a quarter of the Shuffle Positions there are.
- Those two limits keep the score of every Pairing an exact number.
- Fields of up to 8 Entrants are solved by trying every set of Pairings.
- With no work limit given, a field is allowed 50,000 steps plus 2,000 for each Entrant times the number of binary digits in the count.
- A step is one move of the matcher, or one comparison the proof step makes on the way to checking its answer.
- Larger fields are solved by the matcher, which carries a proof that is checked on every call.
- If two sets of Pairings tie on every level, the engine's choice is fixed for a given version but is not defined here. With distinct positions this is not expected to happen.
