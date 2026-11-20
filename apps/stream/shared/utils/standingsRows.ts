import type { StandingsModeConfig } from '../screenModeConfigs/standings';
import type { PlayerGameData } from '../types/game';
import { isColumnVisible } from '../screenModeConfigs/subShapes';
import { getMtgGameData } from './gameData';

/** What a Standings row reads of a Player. */
export interface StandingsPlayer {
	id: number;
	name: string;
	position: number | null;
	wins: number | null;
	losses: number | null;
	draws: number | null;
	points: number | null;
	gameData: PlayerGameData | null;
}

/** One Player's Round Standings at a fixed Round. */
export interface StandingsRoundStanding {
	playerId: number;
	position: number | null;
	wins: number | null;
	losses: number | null;
	draws: number | null;
	points: number | null;
}

/**
 * One row a Standings Screen shows: its Player and position, which order it,
 * and only the fields its visible columns show.
 */
export interface StandingsRow {
	id: number;
	position: number | null;
	name?: string;
	wins?: number | null;
	losses?: number | null;
	draws?: number | null;
	points?: number | null;
	deckName?: string | null;
	deckColors?: string | null;
}

export interface StandingsRowsInput {
	/** The Event's active roster. */
	players: readonly StandingsPlayer[];
	/** The Round Standings at the Round the Screen is fixed at; `null` while it shows current standings. */
	roundStandings: readonly StandingsRoundStanding[] | null;
	/** The members of its watchlist's list; `null` when it names no list that exists. */
	watchlistPlayerIds: readonly number[] | null;
	config: Pick<
		StandingsModeConfig,
		'viewMode' | 'rangeStart' | 'rangeEnd' | 'revealCount' | 'columns'
	>;
}

/**
 * Placed Players by position, unplaced ones last, ties by id: a total order, so
 * a re-read cannot reorder rows that did not change, whatever order it reads them in.
 */
function byStandingsPosition(a: StandingsRow, b: StandingsRow): number {
	return (
		Number(a.position == null) - Number(b.position == null) ||
		(a.position ?? 0) - (b.position ?? 0) ||
		a.id - b.id
	);
}

/**
 * The rows a Standings Screen shows, in order, from its saved configuration:
 * at a fixed Round only the Players holding a Round Standing there, with its
 * figures; in a range the positions it names, every Player tied at its last
 * one included and an unplaced Player counted from its place in the order; in
 * a watchlist its list's members; in a reveal the rows it can reveal. Each row
 * carries only what its visible columns show (#1380). Which of a reveal's rows
 * are revealed is the rendering's, which steps through them.
 */
export function standingsRows({
	players,
	roundStandings,
	watchlistPlayerIds,
	config,
}: StandingsRowsInput): StandingsRow[] {
	const standingOf = roundStandings
		? new Map(roundStandings.map((standing) => [standing.playerId, standing]))
		: null;
	const shows = (key: StandingsModeConfig['columns'][number]['key']) =>
		isColumnVisible(config.columns, key);

	const ordered = players.flatMap((player) => {
		const figures = standingOf ? standingOf.get(player.id) : player;
		if (!figures) return [];
		const row: StandingsRow = { id: player.id, position: figures.position };
		if (shows('name')) row.name = player.name;
		if (shows('record')) {
			row.wins = figures.wins;
			row.losses = figures.losses;
			row.draws = figures.draws;
		}
		if (shows('points')) row.points = figures.points;
		if (shows('deck')) {
			const { deckName, deckColors } = getMtgGameData(player.gameData);
			row.deckName = deckName ?? null;
			row.deckColors = deckColors ?? null;
		}
		return [row];
	});
	ordered.sort(byStandingsPosition);

	switch (config.viewMode) {
		case 'range':
			return ordered.filter((row, index) => {
				const position = row.position ?? index + 1;
				return position >= config.rangeStart && position <= config.rangeEnd;
			});
		case 'watchlist': {
			const members = new Set(watchlistPlayerIds ?? []);
			return ordered.filter((row) => members.has(row.id));
		}
		case 'reveal':
			return ordered.slice(0, config.revealCount);
		default:
			return ordered;
	}
}
