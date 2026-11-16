# Tournament rules

What the Tournament Engine's decisions settle about a tournament's Log, its Flags and its Corrections, and what Score Keepr must do as the engines' Consumer. The Tournament Engine is not built; `docs/tournament-spec.md` holds the rest of its design. Words are defined in `GLOSSARY.md`, reasons in `docs/adr` and each engine package's.

## The Log

- A tournament is its Log. Standings and everything else are worked out from it, and may be cached but are never stored as truth. (ADR-0103)
- Actions are only added. An Action is never edited or removed: changing what was recorded takes a new Action. (ADR-0103)
- Each Action carries the Device that made it and what that Device had seen. (ADR-0103)
- Order comes from a counter and what each Action had seen, never from a clock. (ADR-0103)
- Two Logs combine by keeping every Action from both. (ADR-0103)
- The same Log gives the same tournament on every Device, whatever order its Actions arrived in, with any duplicates, and after any split and rejoin of Devices. (ADR-0103)
- No Device is special. The engine limits no Device in what it may record, pairing a round included. (ADR-0103)
- How Actions travel between Devices is the Consumer's choice. The engine works the same whichever way they come. (ADR-0103)

## Refusals and Flags

- An Action is refused only when it cannot be recorded at all, such as a Result naming an Entrant who was never in that Pairing. (ADR-0104)
- Anything else unusual is recorded and raises a Flag, including a round paired while Results are missing and hand-made Pairings that break a Constraint. (ADR-0104)
- Flags are part of the tournament the engine returns, and the Consumer shows them. (ADR-0104)
- A Flag clears when its cause is fixed, or when an Action accepts the situation as it is. (ADR-0104)

## Clashes

- Each Clash has a fixed rule that picks the same answer on every Device. Neither Action is discarded. (ADR-0104)
- Two Devices may pair the same round while apart. The Clash rule decides which set of Pairings stands. (ADR-0103)
- A Clash whose Actions differ raises a Flag, which stays up until someone settles it. (ADR-0104)

## Calling the other engines

- The Tournament Engine calls the Pairing Engine and the Standings Engine itself. (ADR-0105)
- Pairing a round is one call: it works out the Standings, turns them into the Pairing Engine's input, pairs, and returns an Action holding the Pairings, the input used and the engine version. (ADR-0105)
- Working out a tournament from its Log never pairs again: it reads the recorded Pairings. A later engine version never changes a past round. (ADR-0105)
- The Consumer runs the pairing call in a worker. (ADR-0105)

## Corrections

- When a Correction replaces a Result, everything calculated follows it: Standings, Tiebreakers, and who fills a Single Elimination Slot. (ADR-0106)
- Everything decided holds: Pairings already made, who entered a Phase, and how Sections were formed. (ADR-0106)
- Each decision made from Standings that have since changed is flagged. The Organiser may redo it with a new Action or leave it; the engine never redoes one by itself. (ADR-0106)
- In Single Elimination, a Correction that moves a different Entrant into a later Pairing that already has a Result is flagged, not resolved. (ADR-0106)
- Standings can be worked out as any Action saw them, which reproduces the input of any past decision. (ADR-0106)

## What the Consumer must do

Score Keepr, in `apps/score`, is the Consumer of the engines (ADR-0092). It stores each tournament as its Log (ADR-0103), whose Actions keep every pairing call's input and output (ADR-0105). The engines' own promises are in `packages/pairing/RULES.md` and `packages/standings/RULES.md`.

- Supply consistent facts. The engine checks their shape and refuses only facts that contradict each other, never ones that are merely untrue.
- Keep each Entrant's id the same for the whole tournament: its Shuffle Positions come from it.
- Store the Random Seed with the tournament. Keep it secret until pairing when Pairings must be unpredictable, and change it to re-roll a round.
- Promise seeded, unpredictable choices, never statistically uniform ones. (ADR-0100)
- Choose who is paired: Drops, Late Entries, Awarded Byes, Pods and Pairings kept from a hand-made set are the Consumer passing only the Entrants to pair, one call per group.
- Stop a pairing call that runs too long by ending its worker. The engine's work limit counts steps, never time.
- Decide whether Pairings with Violations, or not proven best, are acceptable. The engine never refuses a valid round.
- Store the final Pairings after a hand-made change. The engine keeps no memory of a check, and the next round's opponents faced follow from what was played.
- Let any Device pair a round, the same round on two Devices apart included. Each set of Pairings is an Action, and the Clash rule decides which stands. (ADR-0103)
- In Single Elimination, fill in each winner and record a drop or a no-show as a Result: the structure never changes once made. For a random draw, supply shuffled Ranks.
- Pass every Entrant to the Standings Engine, one with no Results included, and rank the whole field in one call. Divisions are rows filtered after it, never separate calls.
- For Standings during a tournament, pass the rounds completed so far as the planned rounds. Standings as of round N are a call with only the Results of rounds 1 to N; after a Correction, call again.
- Combine a Team's Players' Results into the one Entrant the Team is.
- Make sure no two Entrants in a Top Cut share a Rank, for example with `random` as the last Tiebreaker: `topCutFrom` refuses a shared Rank.
- Run any play-off match yourself; the engines never schedule one.
