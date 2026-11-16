# Tournament rules

What the Tournament Engine's decisions settle about a tournament's Log, its Flags and its Corrections. The engine is not built; `docs/tournament-spec.md` holds the rest of its design. Words are defined in `GLOSSARY.md`.

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
