# ADR-0153: A Drop takes effect after its round, and every value counted into a Score is capped

Accepted · 2026-11-20

A dropped Entrant's `afterRound` is applied. A Result after that round is refused as `result-after-drop`, and the Entrant counts as dropped only in Standings as of that round or later, where Standings are as of the last round that holds a Result. Every value counted into a Score or a total, points, Extra Scores and games, is a whole number no further than 1,000,000 from 0. We applied `afterRound` because the engine already took it, and ignored it: Standings as of an earlier round treated an Entrant who had not yet dropped as dropped, capping their rate under a Preset. We capped values because a Score is a plain number, and an uncapped one could stop being exact, which ADR-0101 forbids.

## Considered Options

- **Remove `afterRound` from the input**, and have the Consumer pass a Status of dropped only in calls as of the Drop or later. Rejected: the Consumer would have to work out, for every past view, who had dropped by then, and a Status read from the Log as it stands could not be passed as it is. Applied, the same Entrant list serves every round.
- **Say "as of" with its own input** rather than the last round holding a Result. Rejected for now: `apps/score/RULES.md` already makes Standings as of round N a call with the Results of rounds 1 to N, so the last round with a Result is that N.
- **Exact sums with bigints**, uncapped. Rejected: a Score feeds the Pairing Engine, which refuses one beyond 1,000,000 either way, so a larger value has no use, and capping keeps every row a plain number.

## Consequences

- The cap matches the Pairing Engine's Score limit. A Result list could never hold 2^32 Results for one Entrant, so no Score or total reaches 2^53.
- Planned rounds fewer than the last round holding a Result are refused, so no rate passes 1.
