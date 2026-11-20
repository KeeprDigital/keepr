import { describe, expect, test } from 'vitest';

import type { RateSettings, StandingsInput, Tiebreaker } from '../src/index.ts';
import { configurations } from './support/configurations.ts';
import { mustRank, rowOf } from './support/run.ts';

/**
 * Three rounds, worked out by hand below. Games are [won by the first, won by the second, drawn]
 * and vp is an Extra Score.
 *
 *   1  ann beat ben 2-1, vp 10-4     cal drew dee 1-1-1, vp 7-7
 *   2  ann beat cal 2-0, vp 12-3     dee beat ben 2-0, vp 9-5
 *   3  dee beat ann 2-1, vp 8-6      ben has a Bye (2-0)   cal has an Unplayed Loss (0-2)
 *
 * Both solo kinds count as played. Every Entrant has played 3 rounds:
 *
 *        record    games won-lost-drawn   vp for-against   lost in rounds
 *   ann  2-1-0     5-3-0                  28-15            3
 *   ben  1-2-0     3-4-0 (1 in matches)   9-19             1, 2
 *   cal  0-2-1     1-5-1                  10-19            2, 3
 *   dee  2-0-1     5-2-1                  24-18            none
 */
const event: StandingsInput = {
	entrants: ['ann', 'ben', 'cal', 'dee'].map((id) => ({ id })),
	results: [
		{
			round: 1,
			entrants: ['ann', 'ben'],
			outcomes: ['win', 'loss'],
			games: [2, 1, 0],
			extraScores: { vp: [10, 4] },
		},
		{
			round: 1,
			entrants: ['cal', 'dee'],
			outcomes: ['draw', 'draw'],
			games: [1, 1, 1],
			extraScores: { vp: [7, 7] },
		},
		{
			round: 2,
			entrants: ['ann', 'cal'],
			outcomes: ['win', 'loss'],
			games: [2, 0, 0],
			extraScores: { vp: [12, 3] },
		},
		{
			round: 2,
			entrants: ['dee', 'ben'],
			outcomes: ['win', 'loss'],
			games: [2, 0, 0],
			extraScores: { vp: [9, 5] },
		},
		{
			round: 3,
			entrants: ['dee', 'ann'],
			outcomes: ['win', 'loss'],
			games: [2, 1, 0],
			extraScores: { vp: [8, 6] },
		},
		{ round: 3, entrant: 'ben', kind: 'bye' },
		{ round: 3, entrant: 'cal', kind: 'unplayed-loss' },
	],
	configuration: configurations['score-only'] as StandingsInput['configuration'],
};

const rate: RateSettings = {
	counts: { type: 'wins' },
	rounds: 'played',
	floor: null,
	capIfDropped: null,
};
const none = { numerator: 0, denominator: 1 };

/** One Tiebreaker's exact value for each Entrant, as "numerator/denominator". */
function values(tiebreaker: Tiebreaker, input: StandingsInput = event): Record<string, string> {
	const result = mustRank({
		...input,
		configuration: { ...input.configuration, tiebreakers: [tiebreaker] },
	});
	return Object.fromEntries(
		input.entrants.map(({ id }) => {
			const exact = rowOf(result, id).tiebreakers[0]?.exact;
			return [
				id,
				exact === null || exact === undefined ? 'none' : `${exact.numerator}/${exact.denominator}`,
			];
		}),
	);
}

describe('each Tiebreaker against values worked out by hand', () => {
	test.each<[string, Tiebreaker, Record<string, string>]>([
		// Match win rates: ann 2/3, ben 1/3, cal 0, dee 2/3.
		// ann faced ben, cal, dee: (1/3 + 0 + 2/3) / 3. ben faced ann, dee: (2/3 + 2/3) / 2.
		[
			"opponents' match win rate",
			{ type: 'opponents-match-win-rate', rate, withNoOpponents: none },
			{ ann: '1/3', ben: '2/3', cal: '2/3', dee: '1/3' },
		],
		// The line above, averaged again. ann: (2/3 + 2/3 + 1/3) / 3. ben: (1/3 + 1/3) / 2.
		[
			"opponents' opponents' match win rate",
			{ type: 'opponents-opponents-match-win-rate', rate, withNoOpponents: none },
			{ ann: '5/9', ben: '1/3', cal: '1/3', dee: '5/9' },
		],
		// Game win rates, (3 x won + drawn) / (3 x games): ann 15/24, ben 9/21, cal 4/21, dee 16/24.
		// ann: (9/21 + 4/21 + 14/21) / 3. ben: (5/8 + 2/3) / 2. dee: (4/21 + 9/21 + 5/8) / 3.
		[
			"opponents' game win rate",
			{ type: 'opponents-game-win-rate', win: 3, draw: 1, floor: null, withNoOpponents: none },
			{ ann: '3/7', ben: '31/48', cal: '31/48', dee: '209/504' },
		],
		// Losses over rounds played.
		['loss rate', { type: 'loss-rate' }, { ann: '1/3', ben: '2/3', cal: '2/3', dee: '0/1' }],
		// ann: (2/3 + 2/3 + 0) / 3. ben: (1/3 + 0) / 2. dee: (2/3 + 2/3 + 1/3) / 3.
		[
			"opponents' loss rate",
			{ type: 'opponents-loss-rate', withNoOpponents: none },
			{ ann: '4/9', ben: '1/6', cal: '1/6', dee: '5/9' },
		],
		[
			'wins in matches',
			{ type: 'wins', includeByes: false },
			{ ann: '2/1', ben: '0/1', cal: '0/1', dee: '2/1' },
		],
		[
			'wins with Byes',
			{ type: 'wins', includeByes: true },
			{ ann: '2/1', ben: '1/1', cal: '0/1', dee: '2/1' },
		],
		[
			'games won in matches',
			{ type: 'game-wins', includeByes: false },
			{ ann: '5/1', ben: '1/1', cal: '1/1', dee: '5/1' },
		],
		// ben's Bye adds its 2 games won.
		[
			'games won with Byes',
			{ type: 'game-wins', includeByes: true },
			{ ann: '5/1', ben: '3/1', cal: '1/1', dee: '5/1' },
		],
		[
			'Extra Score scored',
			{ type: 'extra-score-total', extraScore: 'vp', of: 'for' },
			{ ann: '28/1', ben: '9/1', cal: '10/1', dee: '24/1' },
		],
		[
			'Extra Score conceded',
			{ type: 'extra-score-total', extraScore: 'vp', of: 'against' },
			{ ann: '15/1', ben: '19/1', cal: '19/1', dee: '18/1' },
		],
		[
			'Extra Score difference',
			{ type: 'extra-score-total', extraScore: 'vp', of: 'difference' },
			{ ann: '13/1', ben: '-10/1', cal: '-9/1', dee: '6/1' },
		],
		// The round of each loss, squared: ann 3², ben 1² + 2², cal 2² + 3².
		['later losses', { type: 'later-losses' }, { ann: '9/1', ben: '5/1', cal: '13/1', dee: '0/1' }],
	])('%s', (_, tiebreaker, expected) => {
		expect(values(tiebreaker)).toEqual(expected);
	});

	test.each<[string, StandingsInput['results'], Record<string, string>]>([
		// ann and ben are level on 3, and ann beat ben.
		[
			'two level, one beat the other',
			[
				{ round: 1, entrants: ['ann', 'ben'], outcomes: ['win', 'loss'] },
				{ round: 2, entrant: 'ben', kind: 'bye' },
			],
			{ ann: '1/1', ben: '0/1' },
		],
		// All three are level on 3, so it says nothing.
		[
			'three level',
			[
				{ round: 1, entrants: ['ann', 'ben'], outcomes: ['win', 'loss'] },
				{ round: 2, entrants: ['ben', 'cal'], outcomes: ['win', 'loss'] },
				{ round: 3, entrants: ['cal', 'ann'], outcomes: ['win', 'loss'] },
			],
			{ ann: 'none', ben: 'none', cal: 'none' },
		],
		// Level on 3, and each beat the other once.
		[
			'two level, even between them',
			[
				{ round: 1, entrants: ['ann', 'ben'], outcomes: ['win', 'loss'] },
				{ round: 2, entrants: ['ben', 'ann'], outcomes: ['win', 'loss'] },
			],
			{ ann: 'none', ben: 'none' },
		],
	])('head to head, %s', (_, results, expected) => {
		const ids = Object.keys(expected);
		expect(
			values({ type: 'head-to-head' }, { ...event, entrants: ids.map((id) => ({ id })), results }),
		).toEqual(expected);
	});
});
