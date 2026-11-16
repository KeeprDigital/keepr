# @keepr/pairing

The Pairing Engine: it pairs Swiss rounds, lays out Single Elimination, and checks Pairings made by hand. Pure TypeScript functions over plain JSON, with no third-party runtime dependencies, that run in a browser or on a server, offline.

It is a package of the workspace, consumed as source (ADR-0092, in the root `docs/adr`): nothing is built or published. It depends on `@keepr/engine-core` alone, which holds its types and the seeded-random routine, and never on `@keepr/standings`.

- `RULES.md`: what the engine promises, and the exact cost of every Constraint. It wins any disagreement.
- `docs/adr`: why (ADR-0096 to ADR-0100).
- `apps/score/GLOSSARY.md`: the words. Use them.

## Use

```ts
import { pairRound, startingConfiguration } from '@keepr/pairing';

const result = pairRound({
	system: 'swiss',
	entrants: [
		{ id: 'ann', score: 3, opponents: ['bob'], byes: 0 },
		{ id: 'bob', score: 0, opponents: ['ann'], byes: 0 },
		{ id: 'cat', score: 3, opponents: [], byes: 1 },
	],
	configuration: startingConfiguration,
	randomSeed: tournamentSeed,
	round: 2,
});
if (result.ok) {
	// result.pairings, result.bye, result.violations, result.provenBest
} else {
	// result.errors: every problem found, each with a code
}
```

| Export | What |
|---|---|
| `pairRound(input: RoundInput): RoundResult` | One Swiss round. |
| `buildStructure(input: StructureInput): StructureResult` | A whole Single Elimination. |
| `checkPairings(input: CheckInput): CheckResult` | Pairings and Byes made by hand, described and optionally compared with the best (`compare: true`). |
| `startingConfiguration` | A Starting Configuration to pass in or adapt. Nothing is applied unless passed. |
| `ENGINE_VERSION` | The version every result carries. |

The types are re-exported from `@keepr/engine-core`. Every result is `{ ok: false, errors }` or `{ ok: true, … }`, and nothing throws. A Constraint is `{ type: '<name>', ...settings }`, such as `{ type: 'bye-cap', max: 1 }` or `{ type: 'avoid-same-group-label', kind: 'club' }`.

From Standings, `@keepr/engine-core` maps rows to input: `pairingEntrantsFrom(rows, { present, groups })` for a Swiss round, and `topCutFrom(rows, size)` for a cut, which returns an error rather than choose between Entrants sharing a Rank at the cut line. The engine accepts facts from anywhere.

What the Consumer must do around these calls is in `apps/score/RULES.md`.

## Versioning

- `ENGINE_VERSION` is plain semver, changed by hand with the rules it implements. A test keeps it equal to `version` in `package.json`; release-please does not manage it (ADR-0092). The Standings Engine has its own.
- Any change that alters the output for an existing input is a major release. That includes `@keepr/engine-core`'s seeded-random routine, which both engines read.
- Reproducing an old round means running the engine at that version. Score Keepr records the Pairings it was given, and never pairs a past round again (ADR-0105).

## Scale

The targets are 10,000 Entrants in 2 s and 20,000 in 10 s per round, on one thread. CI's `Packages` job runs `pnpm bench:packages`: a simulated event of 15 rounds at 10,001 and at 20,001 Entrants, failing if a round is over target or not proven best. Where exactness and speed conflict, exactness wins and the target loosens (ADR-0099).

Measured on Apple M4, Node 26, one thread, the whole call including input checks, a simulated event with drops, Starting Configuration:

| Entrants | Rounds | Slowest round |
|---|---|---|
| 2,001 | 9 | under 0.1 s |
| 10,001 | 15 | 0.3 to 0.7 s |
| 20,001 | 15 | 1.1 to 2.1 s |
| 50,000 | 6 | 4.0 s |

Every round was proven best. Ten other Configurations, one round each at 2,001, 6,001 and 20,001 Entrants, were all proven best and none took over 1.0 s; the slowest were `pair-adjacent-by-rank` with an odd count and no Bye rule, `prefer-same-group-label` over four regions mid-event, and a Pair-down choice by Rank.

The built-in work ceiling (`RULES.md` § Limits today) only stops a fault from hanging a call: whole events of up to 20,001 Entrants use under a twentieth of it. A Consumer that needs a bound in time runs the engine in a worker and ends it.

Not yet shown: speed on a mid-range laptop or in a browser. The M4 is faster than the target machine.

## Commands

In this directory:

```
pnpm test                       # vitest run
pnpm test -u                    # re-record scenario answers after an intended change
pnpm typecheck
pnpm bench 10001 15 --check     # time a simulated event of <entrants> <rounds>
```
