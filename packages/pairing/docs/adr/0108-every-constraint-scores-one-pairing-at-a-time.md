# ADR-0108: Every Constraint scores one Pairing at a time

Accepted · 2026-11-16 · Folded from Score Keepr's Pairing Engine spec under ADR-0095.

Each Constraint gives a cost to one Pairing, or to the Bye, on its own, and a set of Pairings costs the sum (`RULES.md` § Best). We chose this because the matcher and the proof it checks on every call rest on each possible Pairing having a cost of its own (ADR-0099, ADR-0100). The price is that no Constraint can judge the round as a whole: "make the single worst Score gap as small as possible" cannot be stated. A measure stands in for such a goal instead: `pair-close-in-score` squares each gap, so one wide gap costs more than several narrow ones, and the pair-by-Rank Constraints square their distance the same way.

## Considered Options

- **Constraints that judge the whole round**, such as the largest gap in it. Rejected: each would need its own way of finding and proving the best set, outside the one matcher every Constraint now shares.

## Consequences

- A new Constraint is a catalogue entry only if it can be scored one Pairing at a time. One that cannot needs a redesign, not an addition.
- Squared measures prefer spreading a gap over several Pairings to concentrating it in one, which is the intended stand-in for keeping the worst gap small, not the same thing.
