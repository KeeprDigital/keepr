import type { StandingsColumnKey } from '~~/shared/types/enums';
import type { ScreenOutputStandingsResponse } from '~~/shared/types/screenOutputReads';
import type { StandingsRow } from '~~/shared/utils/standingsRows';
import type { PositionChange } from '~~/shared/utils/standingsPositionChange';
import type { ScreenContext } from '~/composables/screen/useScreenContext';
import { isColumnVisible } from '~~/shared/screenModeConfigs/subShapes';
import { formatPlayerRecord } from '~~/shared/utils/playerRecord';
import { formatPositionChange, positionChange } from '~~/shared/utils/standingsPositionChange';
import { useScreenModeFreshness } from '~/modules/screen-mode/freshness';
import { useScreenModeHearing } from '~/modules/screen-mode/hearing';
import { usePaginatedScreenMode } from '~/modules/screen-mode/pagination';

/**
 * The Standings read's answer, and whether it was read with the Position
 * Change column showing: only then does its lack of a previous Round mean
 * the column has nothing to compare (#905).
 */
type StandingsRead = ScreenOutputStandingsResponse & { readPositionChange: boolean };

export function useStandingsModeData(context: ScreenContext) {
	const config = useScreenModeConfig(context, 'standings');

	const outputReads = useScreenOutputReads(context);
	const eventStore = useEventStore();

	const showsPositionChange = () => isColumnVisible(config.value.columns, 'positionChange');

	// ── Data Loading ──
	/**
	 * One Screen Output read answers the rows Standings shows, derived on the
	 * server from the saved configuration (#604, #1380), so an edit of what
	 * selects or shapes them reads again. It is held here, never in the Player
	 * store, so an operator's roster cannot stand in for it (#603).
	 */
	const freshness = useScreenModeFreshness<StandingsRead>({
		hearing: useScreenModeHearing(context, 'standings', () => config.value),
		source: () => {
			if (!outputReads.scopeKey.value) return null;
			const { viewMode, playerListId, roundId, rangeStart, rangeEnd, revealCount, columns } =
				config.value;
			const shown = columns.flatMap((column) => (column.visible ? [column.key] : [])).join(',');
			return `${outputReads.scopeKey.value}:${viewMode}:${playerListId}:${roundId}:${rangeStart}-${rangeEnd}:${revealCount}:${shown}`;
		},
		read: async () => {
			const readPositionChange = showsPositionChange();
			return {
				...(await outputReads.standings()),
				readPositionChange,
			};
		},
		initialData: {
			rows: [],
			round: null,
			watchlist: null,
			previousRoundPositions: null,
			readPositionChange: false,
		},
		errorMessage: 'Failed to load standings data',
	});
	const loading = freshness.loading;
	const error = freshness.error;
	const round = computed(() => freshness.data.value.round);
	const watchlist = computed(() => freshness.data.value.watchlist);
	const previousRoundPositionMap = computed(() => {
		const previous = freshness.data.value.previousRoundPositions;
		return previous
			? new Map(previous.positions.map(({ playerId, position }) => [playerId, position]))
			: null;
	});

	// ── Header ──
	const headerText = computed(() => computeHeaderText());
	const visibleColumns = computed(() => config.value.columns.filter((c) => c.visible));

	// ── Display Rows ──
	/**
	 * The rows the read answers, in its order. A reveal's are the rows it can
	 * reveal, of which it shows those revealed so far: stepping through them is
	 * the rendering's, so a reveal never waits on a read.
	 */
	const displayRows = computed(() => {
		const rows = freshness.data.value.rows;
		if (config.value.viewMode !== 'reveal') return rows;

		const revealable = rows.slice(0, config.value.revealCount);
		const revealed = config.value.revealedCount;
		return config.value.revealOrder === 'bottomUp'
			? // The last N revealed (e.g., revealed=3 of 8: positions 6, 7 and 8).
				revealable.slice(Math.max(0, revealable.length - revealed))
			: revealable.slice(0, revealed);
	});

	// ── Pagination ──
	const { rowCount, pageData, pageSize, totalPages, currentPage, setPage, nextPage, prevPage } =
		usePaginatedScreenMode(context, { mode: 'standings', config, rows: displayRows });

	// ── Header Text Computation ──
	function computeHeaderText(): string {
		if (config.value.headerText) return config.value.headerText;

		if (config.value.roundId && round.value?.id === config.value.roundId) {
			return `End of ${round.value.name}`;
		}

		switch (config.value.viewMode) {
			case 'range':
				return config.value.rangeStart === 1
					? `Top ${config.value.rangeEnd} Standings`
					: `Standings (${config.value.rangeStart}-${config.value.rangeEnd})`;
			case 'watchlist': {
				return watchlist.value?.name ?? 'Players to Watch';
			}
			case 'reveal':
				return `Top ${config.value.revealCount}`;
			default:
				return 'Standings';
		}
	}

	// ── Position Change ──
	/**
	 * The Position Change column shows, but the read found no previous Round
	 * holding Round Standings, so every cell is blank (#905).
	 */
	const noPreviousRoundStandings = computed(
		() => freshness.data.value.readPositionChange && !freshness.data.value.previousRoundPositions,
	);

	/** How far a row's Player moved since the previous Round (#755). */
	function positionChangeOf(row: StandingsRow): PositionChange {
		return positionChange(row.id, row.position, previousRoundPositionMap.value);
	}

	// ── Cell Formatting ──
	function formatCell(row: StandingsRow, key: StandingsColumnKey): string {
		const event = eventStore.displayEvent;

		switch (key) {
			case 'position':
				return row.position != null ? String(row.position) : '-';
			case 'name':
				return row.name ?? '';
			case 'record':
				return formatPlayerRecord(row, event);
			case 'points':
				return row.points != null ? String(row.points) : '-';
			case 'deck':
				return row.deckName ?? '-';
			case 'positionChange':
				return formatPositionChange(positionChangeOf(row));
		}
	}

	// ── Empty State ──
	const isEmpty = computed(() => freshness.answered.value && displayRows.value.length === 0);
	const emptyMessage = computed(() => {
		if (config.value.roundId) {
			return 'No standings snapshot available for this round';
		}

		if (config.value.viewMode === 'watchlist') {
			if (!config.value.playerListId) return 'Select a player list in settings';
			return 'No players in this list';
		}
		if (config.value.viewMode === 'reveal' && config.value.revealedCount === 0) {
			return 'Waiting for reveal...';
		}
		return 'No standings data available';
	});

	return {
		/** Rendering Readiness: its first read has answered or failed. */
		ready: freshness.answered,
		config,
		loading,
		/** Whether its rows are a read's answer, or it selects nothing: false only while its first read is in flight. */
		answered: freshness.answered,
		error,
		isEmpty,
		emptyMessage,
		headerText,
		visibleColumns,
		displayRows,
		pageData,
		pageSize,
		rowCount,
		currentPage,
		totalPages,
		nextPage,
		prevPage,
		setPage,
		formatCell,
		positionChangeOf,
		noPreviousRoundStandings,
	};
}
