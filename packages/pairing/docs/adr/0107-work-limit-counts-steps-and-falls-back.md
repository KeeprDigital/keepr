# ADR-0107: The work limit counts steps, and reaching it still returns Pairings

Accepted · 2026-11-16 · Folded from Score Keepr's Pairing Engine spec under ADR-0095.

A Swiss call's work is bounded in steps the engine counts, never in time. A call that reaches its bound returns a complete, valid set of Pairings marked not proven, not an error. With no work limit given, a built-in ceiling applies (`RULES.md` § Limits today). We chose steps because the engine reads no clock: the same input must give the same Pairings on every machine and under any load, or a recorded round could not be reproduced. We chose a fallback over an error because the engine never refuses a valid round, and an Organiser mid-event needs Pairings.

## Considered Options

- **A time limit.** Rejected: the Pairings would depend on the machine's speed and load, so the same input could give different answers.
- **An error when the limit is reached.** Rejected: it leaves the Consumer nothing to show. A valid set marked not proven, with its Violations listed, lets the Organiser decide.
- **No built-in ceiling.** Rejected: the matcher has no worst-case time bound (ADR-0099), and a fault inside it could hang a call.

## Consequences

- A Consumer that needs a bound in time runs the engine in a worker and ends it (`apps/score/RULES.md` § What the Consumer must do).
- A not-proven result's Violations are not claimed to be the fewest possible.
- The ceiling is set far above anything measured, so it catches a fault rather than limiting a real event: whole events of up to 20,001 Entrants use under a twentieth of it. Every loop in the matcher that could run away counts a step.
