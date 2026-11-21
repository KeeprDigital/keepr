import type { StandingsRowsInput } from '~~/shared/utils/standingsRows';
import { describe, expect, it } from 'vitest';
import { standingsRows } from '~~/shared/utils/standingsRows';

const ALL_COLUMNS = [
	{ key: 'position', visible: true },
	{ key: 'name', visible: true },
	{ key: 'record', visible: true },
	{ key: 'points', visible: true },
	{ key: 'deck', visible: true },
] as const;

/** A Player as the roster holds them, with fields no Standings row carries. */
function player(id: number, name: string, position: number | null) {
	return {
		id,
		name,
		position,
		wins: 10 - id,
		losses: id,
		draws: 0,
		points: (10 - id) * 3,
		gameData: { type: 'mtg' as const, deckName: `Deck ${id}`, deckColors: 'UR' },
		pronouns: 'they/them',
		externalId: `melee-${id}`,
		lgs: 'Somewhere',
	};
}

const roster = ['Alice', 'Bob', 'Charlie', 'Diana', 'Ethan'].map((name, index) =>
	player(index + 1, name, index + 1),
);

type Overrides = Partial<Omit<StandingsRowsInput, 'config'>> & {
	config?: Partial<StandingsRowsInput['config']>;
};

function rows(overrides: Overrides = {}) {
	return standingsRows({
		players: roster,
		roundStandings: null,
		watchlistPlayerIds: null,
		...overrides,
		config: {
			viewMode: 'all',
			rangeStart: 1,
			rangeEnd: 16,
			revealCount: 8,
			columns: [...ALL_COLUMNS],
			...overrides.config,
		},
	});
}

const names = (shown: { name?: string }[]) => shown.map((row) => row.name);

describe('the rows a Standings Screen shows', () => {
	it.each([
		['all', {}, ['Alice', 'Bob', 'Charlie', 'Diana', 'Ethan']],
		['a range from the top', { viewMode: 'range', rangeStart: 1, rangeEnd: 2 }, ['Alice', 'Bob']],
		[
			'a range further down',
			{ viewMode: 'range', rangeStart: 3, rangeEnd: 4 },
			['Charlie', 'Diana'],
		],
		['the top of a reveal', { viewMode: 'reveal', revealCount: 3 }, ['Alice', 'Bob', 'Charlie']],
	] as const)('shows %s', (_view, config, expected) => {
		expect(names(rows({ config }))).toEqual(expected);
	});

	it('orders placed Players by position, unplaced ones last, ties by id', () => {
		const shown = rows({
			players: [
				player(9, 'Ivy', null),
				player(4, 'Dee', 2),
				player(7, 'Gus', null),
				player(5, 'Eve', 2),
			],
		});

		expect(shown.map((row) => row.id)).toEqual([4, 5, 7, 9]);
	});

	// An unplaced Player counts from its place in the order, after every placed one.
	it.each<{ placed: number; range: [number, number]; shown: string[] }>([
		{ placed: 0, range: [1, 3], shown: ['Alice', 'Bob', 'Charlie'] },
		{ placed: 2, range: [2, 3], shown: ['Bob', 'Charlie'] },
		{ placed: 2, range: [1, 2], shown: ['Alice', 'Bob'] },
	])(
		'counts an unplaced Player from its place in a range ($placed placed, range $range)',
		({ placed, range, shown }) => {
			const players = roster
				.slice(0, 4)
				.map((entry, index) => (index < placed ? entry : { ...entry, position: null }));

			expect(
				names(
					rows({
						players,
						config: { viewMode: 'range', rangeStart: range[0], rangeEnd: range[1] },
					}),
				),
			).toEqual(shown);
		},
	);

	it('shows every Player tied at the last position of a range', () => {
		const players = roster.slice(0, 4).map((entry, index) => ({
			...entry,
			position: Math.min(index + 1, 2),
		}));

		expect(
			names(rows({ players, config: { viewMode: 'range', rangeStart: 1, rangeEnd: 2 } })),
		).toEqual(['Alice', 'Bob', 'Charlie', 'Diana']);
	});

	it.each([
		['its members', [4, 2], ['Bob', 'Diana']],
		['no one, while it has no list', null, []],
	] as const)('filters a watchlist to %s', (_who, watchlistPlayerIds, expected) => {
		expect(names(rows({ watchlistPlayerIds, config: { viewMode: 'watchlist' } }))).toEqual(
			expected,
		);
	});

	it("shows only the Players holding a Round Standing at a fixed Round, with that Round's figures", () => {
		const shown = rows({
			roundStandings: [
				{ playerId: 3, position: 1, wins: 5, losses: 0, draws: 1, points: 16 },
				{ playerId: 1, position: 2, wins: 4, losses: 1, draws: 0, points: 12 },
			],
		});

		expect(shown).toEqual([
			expect.objectContaining({
				id: 3,
				name: 'Charlie',
				position: 1,
				wins: 5,
				draws: 1,
				points: 16,
			}),
			expect.objectContaining({ id: 1, name: 'Alice', position: 2, wins: 4, points: 12 }),
		]);
	});

	it('carries only the fields its visible columns show', () => {
		const [first] = rows({
			config: {
				columns: [
					{ key: 'position', visible: true },
					{ key: 'name', visible: true },
					{ key: 'record', visible: false },
					{ key: 'points', visible: true },
					{ key: 'deck', visible: false },
				],
			},
		});

		expect(first).toEqual({ id: 1, position: 1, name: 'Alice', points: 27 });
	});

	it.each([
		['record', { wins: 9, losses: 1, draws: 0 }],
		['deck', { deckName: 'Deck 1', deckColors: 'UR' }],
		['positionChange', {}],
	] as const)('carries what its %s column shows', (key, fields) => {
		const [first] = rows({ config: { columns: [{ key, visible: true }] } });

		expect(first).toEqual({ id: 1, position: 1, ...fields });
	});
});
