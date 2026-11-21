import type { EffectScope } from 'vue';
import type { StandingsRow } from '~~/shared/utils/standingsRows';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '@keepr/nuxt-layer/test/helpers/deferred';
import { createMockEvent, createMockPlayer, createMockRound } from '~~/test/helpers/fixtures';
import { createFakeEventChannel } from '~~/test/helpers/realtime-mock';
import { screenContextOf } from '~~/test/nuxt/helpers/screenContext';

const defaultConfig = {
	viewMode: 'all' as string,
	columns: [
		{ key: 'position', visible: true },
		{ key: 'name', visible: true },
		{ key: 'record', visible: true },
		{ key: 'points', visible: true },
		{ key: 'deck', visible: false },
	],
	showArchetypeColors: false,
	roundId: undefined as number | undefined,
	rowsPerPage: 10,
	currentPage: 1,
	autoPageEnabled: false,
	autoPageIntervalMs: 5000,
	rotationAnchor: undefined as number | undefined,
	headerText: '',
	rangeStart: 1,
	rangeEnd: 16,
	revealCount: 8,
	revealedCount: 0,
	revealOrder: 'bottomUp' as string,
	playerListId: null as number | null,
};

const mutableConfig = reactive({ ...defaultConfig });

/** Ten rows in position order, as the Standings read answers them: name, wins, losses, draws, points. */
const rows: StandingsRow[] = (
	[
		['Alice', 5, 1, 0, 15],
		['Bob', 4, 2, 0, 12],
		['Charlie', 3, 3, 0, 9],
		['Diana', 3, 3, 1, 10],
		['Ethan', 2, 4, 0, 6],
		['Fiona', 1, 5, 0, 3],
		['George', 1, 5, 1, 4],
		['Helen', 0, 6, 0, 0],
		['Ivan', 0, 6, 0, 0],
		['Jane', 0, 6, 0, 0],
	] as const
).map(([name, wins, losses, draws, points], index) => ({
	id: index + 1,
	name,
	position: index + 1,
	wins,
	losses,
	draws,
	points,
}));

/** The rows the server answers; the Standings read answers them. */
let serverRows = [...rows];

/** An operator's loaded, stale Player store: a rendering must never read its roster (#603). */
const mockPlayerStore = reactive({
	players: [createMockPlayer({ id: 99, name: 'Stale Store Player', position: 1 })],
	isLoaded: true,
	loadPlayersFrom: vi.fn(),
});
const mockScreenStore = {
	updateModeConfig: vi.fn(),
};
const mockEventStore = reactive({
	displayEvent: createMockEvent(),
});
const mockEventId = ref<number | null>(1);
const mockInteractive = ref(false);
const mockIsSynced = ref(true);
let mockServerNow = 1_000_000;
const { mockFetch } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
}));
const realtime = createFakeEventChannel();
const { deliver } = realtime;

mockNuxtImport('$fetch', () => mockFetch);
mockNuxtImport('tryUseRealtime', () => () => realtime.transport);
mockNuxtImport('usePlayerStore', () => () => mockPlayerStore);
mockNuxtImport('useScreenStore', () => () => mockScreenStore);
mockNuxtImport('useEventStore', () => () => mockEventStore);
const screenContext = screenContextOf({
	screen: ref({ id: 1, name: 'Test' }),
	eventId: mockEventId,
	interactive: mockInteractive,
});
mockNuxtImport('useScreenModeConfig', () => () => computed(() => mutableConfig));
// Server time is the Page Rotation's clock.
mockNuxtImport('useServerTime', async () =>
	(await import('@keepr/nuxt-layer/test/nuxt/helpers/serverTime')).fakeServerTime(() => ({
		isSynced: mockIsSynced,
		getServerTime: () => mockServerNow,
	})),
);

/** The Standings Screen Output read's answer; by default, the roster as it stands. */
function standingsRead(overrides: Record<string, unknown> = {}) {
	return {
		rows: [...serverRows],
		round: null,
		watchlist: null,
		previousRoundPositions: null,
		...overrides,
	};
}

function answerReads(overrides: Record<string, unknown>) {
	mockFetch.mockImplementation(async () => standingsRead(overrides));
}

const STANDINGS_READ = '/api/screen-output/events/1/screens/1/standings';

const scopes: EffectScope[] = [];

/** A rendering of Standings, its first read answered. */
async function mountStandings() {
	const scope = effectScope();
	scopes.push(scope);
	const result = scope.run(() => useStandingsModeData(screenContext))!;
	await flushPromises();
	return result;
}

const names = (shown: StandingsRow[]) => shown.map((row) => row.name);

describe('useStandingsModeData', () => {
	beforeEach(() => {
		Object.assign(mutableConfig, defaultConfig);
		serverRows = [...rows];
		realtime.reset();
		mockEventStore.displayEvent = createMockEvent();
		mockEventId.value = 1;
		mockInteractive.value = false;
		mockIsSynced.value = true;
		mockServerNow = 1_000_000;
		mockFetch.mockReset();
		mockFetch.mockImplementation(async () => standingsRead());
	});

	afterEach(() => {
		scopes.splice(0).forEach((scope) => scope.stop());
		vi.useRealTimers();
	});

	describe('reading', () => {
		it('reads everything Standings renders from in one Screen Output read', async () => {
			await mountStandings();

			expect(mockFetch).toHaveBeenCalledOnce();
			expect(mockFetch).toHaveBeenCalledWith(STANDINGS_READ, expect.anything());
		});

		// The read answers only the rows and columns it shows, so an edit of either reads again.
		it.each([
			{ what: 'the selected Round', change: { roundId: 3 }, reads: 2 },
			{ what: 'the view', change: { viewMode: 'range' }, reads: 2 },
			{ what: 'the watchlist', change: { playerListId: 42 }, reads: 2 },
			{ what: 'the start of a range', change: { rangeStart: 2 }, reads: 2 },
			{ what: 'the end of a range', change: { rangeEnd: 8 }, reads: 2 },
			{ what: 'the rows a reveal can reveal', change: { revealCount: 4 }, reads: 2 },
			{
				what: 'which columns show',
				change: { columns: defaultConfig.columns.map((column) => ({ ...column, visible: true })) },
				reads: 2,
			},
			{ what: 'how many a reveal has revealed', change: { revealedCount: 2 }, reads: 1 },
		])('reads $reads time(s) in all on a change of $what', async ({ change, reads }) => {
			await mountStandings();

			Object.assign(mutableConfig, change);
			await flushPromises();

			expect(mockFetch).toHaveBeenCalledTimes(reads);
		});

		it('does not read without an Event', async () => {
			mockEventId.value = null;
			await mountStandings();

			expect(mockFetch).not.toHaveBeenCalled();
		});

		it("renders the roster the Standings read answers, never the Player store's", async () => {
			serverRows = [{ id: 21, name: 'Read Player', position: 1 }];

			const { displayRows } = await mountStandings();

			expect(mockPlayerStore.loadPlayersFrom).not.toHaveBeenCalled();
			expect(names(displayRows.value)).toEqual(['Read Player']);
		});
	});

	// Which rows a view shows is the server's (`standingsRows`); stepping through a reveal is the rendering's.
	describe('displayRows', () => {
		it.each([
			[
				'all',
				{},
				['Alice', 'Bob', 'Charlie', 'Diana', 'Ethan', 'Fiona', 'George', 'Helen', 'Ivan', 'Jane'],
			],
			[
				'range, as the read answers it',
				{ viewMode: 'range', rangeStart: 1, rangeEnd: 3 },
				['Alice', 'Bob', 'Charlie', 'Diana', 'Ethan', 'Fiona', 'George', 'Helen', 'Ivan', 'Jane'],
			],
			[
				'reveal bottom-up',
				{
					viewMode: 'reveal',
					revealCount: 8,
					revealedCount: 3,
					revealOrder: 'bottomUp',
				},
				['Fiona', 'George', 'Helen'],
			],
			[
				'reveal top-down',
				{
					viewMode: 'reveal',
					revealCount: 8,
					revealedCount: 3,
					revealOrder: 'topDown',
				},
				['Alice', 'Bob', 'Charlie'],
			],
			['reveal before anything is revealed', { viewMode: 'reveal', revealedCount: 0 }, []],
		] as const)('shows the %s view', async (viewMode, view, expected) => {
			Object.assign(mutableConfig, { viewMode, ...view });

			const { displayRows } = await mountStandings();

			expect(names(displayRows.value)).toEqual(expected);
		});
	});

	describe('headerText', () => {
		it.each([
			['the custom header when one is set', { headerText: 'Custom Header' }, {}, 'Custom Header'],
			['"Standings" for all', { viewMode: 'all' }, {}, 'Standings'],
			[
				'the count for a range from the top',
				{ viewMode: 'range', rangeStart: 1, rangeEnd: 16 },
				{},
				'Top 16 Standings',
			],
			[
				'both ends for a range further down',
				{ viewMode: 'range', rangeStart: 9, rangeEnd: 16 },
				{},
				'Standings (9-16)',
			],
			[
				"the list's name for a watchlist",
				{ viewMode: 'watchlist', playerListId: 42 },
				{
					watchlist: { name: 'VIPs', playerIds: [] },
				},
				'VIPs',
			],
			[
				'a fallback for a watchlist the read does not answer',
				{ viewMode: 'watchlist', playerListId: 999 },
				{},
				'Players to Watch',
			],
			['the count for a reveal', { viewMode: 'reveal', revealCount: 8 }, {}, 'Top 8'],
			[
				'the selected Round',
				{ roundId: 4 },
				{ round: createMockRound({ id: 4, name: 'Round 4' }) },
				'End of Round 4',
			],
		])('reads %s', async (_, config, read, expected) => {
			Object.assign(mutableConfig, config);
			answerReads(read);

			const { headerText } = await mountStandings();

			expect(headerText.value).toBe(expected);
		});
	});

	it('shows only the visible columns, in order', async () => {
		mutableConfig.columns = [
			{ key: 'position', visible: true },
			{ key: 'name', visible: true },
			{ key: 'record', visible: false },
			{ key: 'points', visible: false },
			{ key: 'deck', visible: true },
		];

		const { visibleColumns } = await mountStandings();

		expect(visibleColumns.value.map((column) => column.key)).toEqual(['position', 'name', 'deck']);
	});

	describe('formatCell', () => {
		const unplaced: StandingsRow = { id: 11, position: null, points: null };

		it.each([
			['position', rows[0]!, '1'],
			['position', unplaced, '-'],
			['name', rows[1]!, 'Bob'],
			['record', rows[3]!, '3-3-1'],
			['points', rows[0]!, '15'],
			['points', unplaced, '-'],
			['deck', { ...unplaced, deckName: 'Mono Red', deckColors: 'R' }, 'Mono Red'],
			['deck', rows[0]!, '-'],
		] as const)('formats %s as %j', async (column, row, expected) => {
			const { formatCell } = await mountStandings();

			expect(formatCell(row, column)).toBe(expected);
		});

		it("formats a record with the Event's record settings", async () => {
			mockEventStore.displayEvent = createMockEvent({
				displayRecordSeparator: '/',
				displayHideZeroDraws: false,
			});

			const { formatCell } = await mountStandings();

			expect(formatCell(rows[0]!, 'record')).toBe('5/1/0');
		});
	});

	describe('the empty state', () => {
		it('stays empty while an empty answer is re-read', async () => {
			serverRows = [];
			const { isEmpty, loading } = await mountStandings();

			loading.value = true;
			expect(isEmpty.value).toBe(true);
		});

		it("is not empty while the selected Round's snapshot is still being read", async () => {
			mutableConfig.roundId = 8;
			mockFetch.mockReturnValue(new Promise(() => {}));

			const { isEmpty } = await mountStandings();

			expect(isEmpty.value).toBe(false);
		});

		it.each([
			[
				'a watchlist with no list',
				{ viewMode: 'watchlist', playerListId: null },
				{},
				'Select a player list in settings',
			],
			[
				'an empty watchlist',
				{ viewMode: 'watchlist', playerListId: 42 },
				{ rows: [] },
				'No players in this list',
			],
			[
				'a reveal before anything is revealed',
				{ viewMode: 'reveal', revealedCount: 0 },
				{},
				'Waiting for reveal...',
			],
			[
				'a Round with no snapshot',
				{ roundId: 8 },
				{ rows: [] },
				'No standings snapshot available for this round',
			],
			['no standings at all', { viewMode: 'all' }, { rows: [] }, 'No standings data available'],
		])('explains %s', async (_, config, read, expected) => {
			Object.assign(mutableConfig, config);
			answerReads(read);

			const { emptyMessage } = await mountStandings();

			expect(emptyMessage.value).toBe(expected);
		});
	});

	describe('pages', () => {
		it("writes an operator's page selection to the Screen", async () => {
			mockInteractive.value = true;
			mutableConfig.rowsPerPage = 3;
			const { nextPage, prevPage } = await mountStandings();

			nextPage();
			prevPage();

			expect(
				mockScreenStore.updateModeConfig.mock.calls.map(([, , mode, patch]) => [mode, patch]),
			).toEqual([
				['standings', { currentPage: 2 }],
				['standings', { currentPage: 4 }],
			]);
		});

		it('pages its rows by the configured page size', async () => {
			Object.assign(mutableConfig, { rowsPerPage: 3, currentPage: 2 });

			const { totalPages, pageData } = await mountStandings();

			expect(totalPages.value).toBe(4);
			expect(names(pageData.value)).toEqual(['Diana', 'Ethan', 'Fiona']);
		});
	});

	describe('freshness', () => {
		it('follows a Player edit made elsewhere', async () => {
			const { displayRows } = await mountStandings();
			mockFetch.mockClear();

			serverRows = serverRows.map((row) => (row.id === 2 ? { ...row, wins: 5, points: 15 } : row));
			deliver('player:updated', {
				player: createMockPlayer({ id: 2, name: 'Bob', wins: 5, points: 15 }),
			});
			await flushPromises();

			expect(mockFetch).toHaveBeenCalledOnce();
			expect(displayRows.value[1]).toMatchObject({ name: 'Bob', wins: 5, points: 15 });
		});
	});

	describe('the Position Change column', () => {
		const withPositionChange = [
			{ key: 'position', visible: true },
			{ key: 'name', visible: true },
			{ key: 'positionChange', visible: true },
		];
		// Round 7's Round Standings, measured against Round 6's.
		const roundSeven = {
			round: createMockRound({ id: 7, name: 'Round 7' }),
			rows: [
				{ id: 3, name: 'Charlie', position: 1 },
				{ id: 1, name: 'Alice', position: 2 },
				{ id: 2, name: 'Bob', position: 3 },
				{ id: 4, name: 'Diana', position: 4 },
			],
			previousRoundPositions: {
				roundId: 6,
				positions: [
					{ playerId: 1, position: 1 },
					{ playerId: 2, position: 3 },
					{ playerId: 3, position: 4 },
				],
			},
		};
		const positionChanges = (result: Awaited<ReturnType<typeof mountStandings>>) =>
			result.pageData.value.map((player) => [
				player.name,
				result.formatCell(player, 'positionChange'),
			]);

		beforeEach(() => {
			Object.assign(mutableConfig, { columns: withPositionChange, roundId: 7 });
			answerReads(roundSeven);
		});

		it("shows each Player's Position Change since the previous Round", async () => {
			const result = await mountStandings();

			expect(positionChanges(result)).toEqual([
				['Charlie', '▲3'],
				['Alice', '▼1'],
				['Bob', '–'],
				['Diana', 'new'],
			]);
			expect(result.positionChangeOf(result.pageData.value[0]!)).toEqual({ kind: 'up', by: 3 });
		});

		it("leaves every Player's cell blank when there is no previous Round", async () => {
			answerReads({ ...roundSeven, previousRoundPositions: null });

			const result = await mountStandings();

			expect(positionChanges(result).map(([, change]) => change)).toEqual(['', '', '', '']);
		});

		it("keeps each Player's Position Change in a reveal", async () => {
			Object.assign(mutableConfig, {
				viewMode: 'reveal',
				revealCount: 4,
				revealedCount: 1,
				revealOrder: 'bottomUp',
			});

			const result = await mountStandings();

			expect(positionChanges(result)).toEqual([['Diana', 'new']]);
		});

		it('reads again when the column is shown, so the previous Round is read only for a Screen showing it', async () => {
			mutableConfig.columns = defaultConfig.columns;
			await mountStandings();
			mockFetch.mockClear();

			mutableConfig.columns = withPositionChange;
			await flushPromises();

			expect(mockFetch).toHaveBeenCalledOnce();
		});

		it("follows a change to the Event's Round order while the column shows", async () => {
			await mountStandings();
			mockFetch.mockClear();

			deliver('round:updated', {
				round: createMockRound({ id: 3, name: 'Round 3' }),
			});
			await flushPromises();
			deliver('phase:updated', {
				phase: { id: 1 },
			});
			await flushPromises();
			deliver('round:deleted', { roundId: 6 });
			await flushPromises();

			expect(mockFetch).toHaveBeenCalledTimes(3);
		});

		it("ignores another Round's change while the column is hidden", async () => {
			mutableConfig.columns = defaultConfig.columns;
			await mountStandings();
			mockFetch.mockClear();

			deliver('round:updated', {
				round: createMockRound({ id: 3, name: 'Round 3' }),
			});
			deliver('phase:updated', {
				phase: { id: 1 },
			});
			await flushPromises();

			expect(mockFetch).not.toHaveBeenCalled();
		});

		describe("with no previous Round's Round Standings", () => {
			// Only a read made with the column showing looks for the previous Round (#905).
			it.each([
				['the column shows and its read found none', withPositionChange, null, true],
				[
					'its read found a previous Round',
					withPositionChange,
					roundSeven.previousRoundPositions,
					false,
				],
				['the column is hidden', defaultConfig.columns, null, false],
			])('is reported when %s: %s', async (_, columns, previousRoundPositions, reported) => {
				mutableConfig.columns = columns;
				answerReads({ ...roundSeven, previousRoundPositions });

				const { noPreviousRoundStandings } = await mountStandings();

				expect(noPreviousRoundStandings.value).toBe(reported);
			});

			it("is not reported from a read made before the column showed, while the column's read is pending", async () => {
				mutableConfig.columns = defaultConfig.columns;
				answerReads({ ...roundSeven, previousRoundPositions: null });
				const { noPreviousRoundStandings } = await mountStandings();
				const read = deferred<unknown>();
				mockFetch.mockReturnValue(read.promise);

				mutableConfig.columns = withPositionChange;
				await flushPromises();
				expect(noPreviousRoundStandings.value).toBe(false);

				read.resolve(standingsRead({ ...roundSeven, previousRoundPositions: null }));
				await flushPromises();
				expect(noPreviousRoundStandings.value).toBe(true);
			});

			it("clears once Melee Sync stores a previous Round's Round Standings", async () => {
				answerReads({ ...roundSeven, previousRoundPositions: null });
				const { noPreviousRoundStandings } = await mountStandings();
				expect(noPreviousRoundStandings.value).toBe(true);

				answerReads(roundSeven);
				deliver('melee:roundStandingsSynced', {});
				await flushPromises();

				expect(noPreviousRoundStandings.value).toBe(false);
			});
		});
	});
});
