import type { ScreenOutputStandingsResponse } from '~~/shared/types/screenOutputReads';
import { mapRoundToResponse } from '~~/server/mappers/round';
import { playerService } from '~~/server/services/player';
import { playerListService } from '~~/server/services/playerList';
import { playerRoundStandingsService } from '~~/server/services/playerRoundStandings';
import { roundService } from '~~/server/services/round';
import { requireScreenOutputModeRead } from '~~/server/utils/screenOutputRead';
import { isColumnVisible } from '~~/shared/screenModeConfigs/subShapes';
import { standingsRows } from '~~/shared/utils/standingsRows';

/**
 * The rows this Screen's Standings mode shows, derived from its saved
 * configuration (#604): at the Round it is fixed at, filtered to its watchlist
 * or range, each with only the fields its visible columns show (#1380), and,
 * while its Position Change column shows, those rows' positions in the previous
 * Round (#755). One read, so an output never assembles standings from reads its
 * capability does not reach, and is never sent a Player field it has no use for.
 */
export default defineEventHandler(async (event): Promise<ScreenOutputStandingsResponse> => {
	const { eventId, config } = await requireScreenOutputModeRead(event, 'standings');

	const listId = config.viewMode === 'watchlist' ? config.playerListId : null;
	const showsPositionChange = isColumnVisible(config.columns, 'positionChange');
	const [players, round, roundStandings, list, previousRoundPositions] = await Promise.all([
		playerService().findAll({ eventId }),
		config.roundId ? roundService().findById(config.roundId, eventId) : null,
		config.roundId ? playerRoundStandingsService().findByRoundId(eventId, config.roundId) : null,
		listId ? playerListService().findById(listId, eventId) : null,
		showsPositionChange
			? playerRoundStandingsService().findPreviousRoundPositions(eventId, config.roundId ?? null)
			: null,
	]);
	// A watchlist whose list has since been deleted renders as no watchlist
	// rather than refusing the whole Standings read.
	const watchlistPlayerIds = list
		? await playerListService().getMemberPlayerIds(list.id, eventId)
		: null;

	const rows = standingsRows({ players, roundStandings, watchlistPlayerIds, config });
	const shown = new Set(rows.map((row) => row.id));

	return {
		rows,
		round: round ? mapRoundToResponse(round) : null,
		watchlist: list ? { name: list.name } : null,
		previousRoundPositions: previousRoundPositions && {
			roundId: previousRoundPositions.roundId,
			positions: previousRoundPositions.positions.filter(({ playerId }) => shown.has(playerId)),
		},
	};
});
