import fc from 'fast-check';
import { describe, expect, test } from 'vitest';

import type { StandingsInput, TiebreakerValue } from '../src/index.ts';
import { event, reordered } from './support/arbitraries.ts';
import { mustRank } from './support/run.ts';

const RUNS = { numRuns: 300 };

/**
 * Compares two exact Tiebreaker values. Two that say nothing are level. Only head-to-head says
 * nothing, and then for everyone level so far, so one that does beside one that does not is a fault.
 */
function compareExact(a: TiebreakerValue | undefined, b: TiebreakerValue | undefined): number {
	const x = a?.exact ?? null;
	const y = b?.exact ?? null;
	if (x === null && y === null) return 0;
	if (x === null || y === null) throw new Error('One value says nothing and the other does not');
	const difference =
		BigInt(x.numerator) * BigInt(y.denominator) - BigInt(y.numerator) * BigInt(x.denominator);
	return difference > 0n ? 1 : difference < 0n ? -1 : 0;
}
const ranked = (input: StandingsInput): string[] =>
	input.entrants
		.filter((entrant) => entrant.status?.type !== 'removed')
		.map((entrant) => entrant.id);

describe('rules that hold for every set of Standings', () => {
	test('every Entrant who has not been removed has exactly one row', () => {
		fc.assert(
			fc.property(event(), (input) => {
				const ids = mustRank(input).rows.map((row) => row.id);
				expect([...ids].sort((a, b) => a.localeCompare(b))).toEqual(ranked(input));
			}),
			RUNS,
		);
	});

	test('each Rank is one more than the number of rows ranked strictly ahead', () => {
		fc.assert(
			fc.property(event(), (input) => {
				const { rows } = mustRank(input);
				const ranks = rows.map((row) => row.rank);
				expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
				expect(ranks).toEqual(ranks.map((rank) => ranks.indexOf(rank) + 1));
			}),
			RUNS,
		);
	});

	test('a higher Score never ranks below a lower one', () => {
		fc.assert(
			fc.property(event(), (input) => {
				const scores = mustRank(input).rows.map((row) => row.score);
				expect(scores).toEqual([...scores].sort((a, b) => b - a));
			}),
			RUNS,
		);
	});

	test('rows run by Score, then each Tiebreaker in its direction, and share a Rank only when level on all', () => {
		fc.assert(
			fc.property(event(), (input) => {
				const { rows } = mustRank(input);
				const better = input.configuration.tiebreakers.map((tiebreaker) =>
					tiebreaker.type === 'loss-rate' ||
					tiebreaker.type === 'opponents-loss-rate' ||
					tiebreaker.type === 'random' ||
					(tiebreaker.type === 'extra-score-total' && tiebreaker.of === 'against')
						? -1
						: 1,
				);
				for (const [at, row] of rows.entries()) {
					const previous = rows[at - 1];
					if (previous === undefined) continue;
					// Above zero when the earlier row is ahead, zero when the two are level on everything.
					let ahead = Math.sign(previous.score - row.score);
					for (const [level, direction] of better.entries()) {
						if (ahead !== 0) break;
						ahead = direction * compareExact(previous.tiebreakers[level], row.tiebreakers[level]);
					}
					expect(ahead).toBeGreaterThanOrEqual(0);
					expect(previous.rank === row.rank).toBe(ahead === 0);
				}
			}),
			RUNS,
		);
	});

	test('the same input always gives the same output, and the input is left untouched', () => {
		fc.assert(
			fc.property(event(), (input) => {
				const before = structuredClone(input);
				expect(mustRank(structuredClone(input))).toEqual(mustRank(input));
				expect(input).toEqual(before);
			}),
			RUNS,
		);
	});

	test('the order anything arrives in, and which way round a match is written, never matters', () => {
		fc.assert(
			fc.property(
				event().chain((input) => fc.tuple(fc.constant(input), reordered(input))),
				([input, shuffled]) => {
					expect(mustRank(shuffled)).toEqual(mustRank(input));
				},
			),
			RUNS,
		);
	});

	test('the record and the opponents faced match a plain recount', () => {
		fc.assert(
			fc.property(event(), (input) => {
				for (const row of mustRank(input).rows) {
					const mine = input.results.filter((result) =>
						'entrant' in result ? result.entrant === row.id : result.entrants.includes(row.id),
					);
					const faced = mine
						.filter((result) => 'entrants' in result)
						.sort((a, b) => a.round - b.round)
						.map((result) =>
							'entrants' in result ? (result.entrants.find((id) => id !== row.id) as string) : '',
						);
					expect(row.opponents).toEqual(faced);
					expect(row.record.wins + row.record.losses + row.record.draws).toBe(mine.length);
					expect(row.assignedByes).toBe(
						mine.filter((result) => 'entrant' in result && result.kind === 'bye').length,
					);
					expect(row.awardedByes).toBe(
						mine.filter((result) => 'entrant' in result && result.kind === 'awarded-bye').length,
					);
				}
			}),
			RUNS,
		);
	});

	test('with points from the Outcome, Score matches a plain recount', () => {
		fc.assert(
			fc.property(event({ config: 'starting' }), (input) => {
				for (const row of mustRank(input).rows) {
					let score = 0;
					for (const result of input.results) {
						if ('entrant' in result) {
							if (result.entrant === row.id && result.kind !== 'unplayed-loss') score += 3;
						} else {
							const side = result.entrants.indexOf(row.id);
							if (side >= 0)
								score += { win: 3, draw: 1, loss: 0 }[
									result.outcomes[side] as 'win' | 'draw' | 'loss'
								];
						}
					}
					expect(row.score).toBe(score);
				}
			}),
			RUNS,
		);
	});

	test('adding a Tiebreaker at the end only ever separates Entrants who were level', () => {
		fc.assert(
			fc.property(event(), (input) => {
				const before = new Map(mustRank(input).rows.map((row) => [row.id, row.rank]));
				const extended: StandingsInput = {
					...input,
					configuration: {
						...input.configuration,
						tiebreakers: [...input.configuration.tiebreakers, { type: 'random' }],
					},
				};
				const after = mustRank(extended).rows;
				for (const [at, row] of after.entries()) {
					const next = after[at + 1];
					expect(
						next === undefined || (before.get(row.id) as number) <= (before.get(next.id) as number),
					).toBe(true);
				}
				// A random Tiebreaker at the end leaves nobody level.
				expect(new Set(after.map((row) => row.rank)).size).toBe(after.length);
			}),
			RUNS,
		);
	});

	test('removing an Entrant changes nobody else’s Score, record or opponents', () => {
		fc.assert(
			fc.property(event(), fc.nat(), (input, pick) => {
				const candidates = ranked(input);
				fc.pre(candidates.length > 0);
				const gone = candidates[pick % candidates.length] as string;
				const without: StandingsInput = {
					...input,
					entrants: input.entrants.map((entrant) =>
						entrant.id === gone ? { id: gone, status: { type: 'removed' } } : entrant,
					),
				};
				const facts = (rows: ReturnType<typeof mustRank>['rows']): unknown[] =>
					rows
						.filter((row) => row.id !== gone)
						.sort((a, b) => a.id.localeCompare(b.id))
						.map((row) => [row.id, row.score, row.record, row.opponents]);
				expect(facts(mustRank(without).rows)).toEqual(facts(mustRank(input).rows));
				expect(mustRank(without).rows.some((row) => row.id === gone)).toBe(false);
			}),
			RUNS,
		);
	});

	test('Standings as of an earlier round are what you get by leaving later Results out', () => {
		fc.assert(
			fc.property(event({ config: 'starting', maxRounds: 4 }), (input) => {
				const early: StandingsInput = {
					...input,
					results: input.results.filter((result) => result.round <= 2),
				};
				const scores = new Map(mustRank(early).rows.map((row) => [row.id, row.score]));
				for (const row of mustRank(input).rows)
					expect(row.score).toBeGreaterThanOrEqual(scores.get(row.id) as number);
			}),
			RUNS,
		);
	});
});
