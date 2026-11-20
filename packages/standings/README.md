# @keepr/standings

The Standings Engine: it turns Results into Standings for the Phases before a Top Cut, and into Final Placings once the Top Cut is under way or over. Pure TypeScript functions over plain JSON, with no third-party runtime dependencies, that run in a browser or on a server, offline.

It is a package of the workspace, consumed as source (ADR-0092, in the root `docs/adr`): nothing is built or published. It depends on `@keepr/engine-core` alone, which holds its types, and never on `@keepr/pairing`.

- `RULES.md`: what the engine promises, and the exact definition of every points method, Tiebreaker and Rank. It wins any disagreement.
- `docs/adr`: why (ADR-0101, ADR-0102 and ADR-0153).
- `apps/score/GLOSSARY.md`: the words. Use them.

## Use

```ts
import { computeStandings, presets, startingConfiguration } from '@keepr/standings';

const result = computeStandings({
	entrants: [{ id: 'ann' }, { id: 'bob' }, { id: 'cat', status: { type: 'dropped', afterRound: 1 } }],
	results: [
		{ round: 1, entrants: ['ann', 'bob'], outcomes: ['win', 'loss'] },
		{ round: 1, entrant: 'cat', kind: 'bye' },
	],
	configuration: startingConfiguration, // or presets['magic-2026-02-27'].configuration
});
if (result.ok) {
	// result.rows: best Rank first, each with score, record, tiebreakers, opponents and byes
} else {
	// result.errors: every problem found, each with a code
}
```

| Export | What |
|---|---|
| `computeStandings(input: StandingsInput): StandingsResult` | Standings from every Result given. Pass `plannedRounds` when a rate counts planned rounds, and `randomSeed` when the `random` Tiebreaker is chosen. |
| `finalPlacings(input: FinalPlacingsInput): FinalPlacingsResult` | Final Placings from the Ranks, the Single Elimination structure and the winners so far. |
| `startingConfiguration` | A Configuration to pass in or adapt. Nothing is applied unless passed. |
| `presets` | Each Preset's `source`, `assumptions` and `configuration`, by name. |
| `ENGINE_VERSION` | The version every success carries. |

The types are re-exported from `@keepr/engine-core`. Every result is `{ ok: false, errors }` or `{ ok: true, … }`, and nothing throws. Each error has a `code`, a `message` for a person and the `entrants` involved; the codes are in `RULES.md` § Input errors. A Tiebreaker is `{ type: '<name>', ...settings }`, such as `{ type: 'wins', includeByes: false }`, and a fraction in a Configuration is `{ numerator, denominator }`, never a decimal. Each Tiebreaker value comes back as `exact`, a fraction in lowest terms written as text, and `value`, a plain number for display.

From Standings, `@keepr/engine-core` maps rows to the Pairing Engine's input: `pairingEntrantsFrom(rows, { present, groups })` for a Swiss round, and `topCutFrom(rows, size)` for a Top Cut, which returns an error rather than choose between Entrants sharing a Rank at its line.

What the Consumer must do around these calls is in `apps/score/RULES.md`.

## Versioning

- `ENGINE_VERSION` is plain semver, changed by hand with the rules it implements. A test keeps it equal to `version` in `package.json`. The Pairing Engine has its own.
- Any change that alters the output for an existing input is a major release. A Preset never changes, so a rules update is a new Preset, not a breaking release (ADR-0102).

## Speed

The target is a whole recalculation for 20,000 Entrants over 15 rounds in 1 s, and Final Placings for as many, on one thread, on a mid-range laptop. Measured once, on Apple M4 and Node 26: 20,001 Entrants, 15 rounds and 150,015 Results took about 0.4 s under the Starting Configuration and under each Preset. Final Placings for 20,001 Entrants and a cut of eight take under 0.03 s: their time grows in step with the Entrants outside the cut. Nothing has been measured on a mid-range laptop or in a browser.

`bench/speed.ts` times both at that size. CI's `Packages: Engines` job runs its `bench:check`, which fails if Final Placings take over 1 s or any call is refused. The recalculations are printed but not gated: on a shared CI machine they sit too close to the target.

## Commands

In this directory:

```
pnpm test             # vitest run
pnpm test -u          # record a new scenario's answer, or re-record after an intended change
pnpm typecheck
pnpm bench:check      # Final Placings for 20,001 Entrants within 1 s
pnpm bench 20001 15   # time a recalculation and Final Placings at <entrants> <rounds>
```

`test/scenarios` holds stored inputs and answers that catch an accidental change, and `test/presets.test.ts` reproduces each Preset's document's worked examples.
