import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick, reactive, ref, watch } from 'vue';
import {
	createMockEvent,
	createMockMatch,
	createWireMockRound,
	toWire,
} from '~~/test/helpers/fixtures';

/*
 * The Matches page on the real stores, faking the network and the router: it
 * shows the viewed Round's Matches and Assignments, reads Matches only per
 * Round, and re-reads what a Round sync changed.
 */

const route = reactive({
	params: { eventId: '1' },
	path: '/event/1/matches',
	fullPath: '/event/1/matches',
	query: {} as Record<string, string | undefined>,
});

function buildFullPath() {
	const queryString = new URLSearchParams(
		Object.entries(route.query).filter(
			(entry): entry is [string, string] => typeof entry[1] === 'string',
		),
	).toString();

	route.fullPath = queryString ? `${route.path}?${queryString}` : route.path;
}

const router = {
	currentRoute: ref(route),
	beforeEach: () => () => {},
	afterEach: () => () => {},
	beforeResolve: () => () => {},
	onError: () => () => {},
	resolve: (to?: { path?: string }) => ({
		fullPath: to?.path ?? route.fullPath,
		path: to?.path ?? route.path,
		href: to?.path ?? route.fullPath,
		matched: [],
	}),
	options: {
		history: {
			state: {},
			base: '/',
		},
	},
	push: async () => {},
	replace: async ({ query }: { query: Record<string, string | undefined> }) => {
		for (const key of Object.keys(route.query)) delete route.query[key];

		for (const [key, value] of Object.entries(query)) {
			if (value !== undefined) route.query[key] = value;
		}

		buildFullPath();
		router.currentRoute.value = route;

		await nextTick();
	},
};

type Wired = Record<string, unknown>;

/** What the server holds for Event 1, and every read and write it was sent. */
const server = vi.hoisted(() => ({
	rounds: [] as Wired[],
	matchesByRound: new Map<number, Wired[]>(),
	assignmentsByRound: new Map<number, Wired[]>(),
	/** Whether the Event re-read after a sync fails, leaving the browser behind. */
	eventReadFails: false,
	requests: [] as string[],
}));

function requestKey(url: string, init?: { method?: string; query?: Record<string, unknown> }) {
	const query = init?.query ? `?${new URLSearchParams(init.query as never).toString()}` : '';
	return `${init?.method ?? 'GET'} ${url}${query}`;
}

const { mockFetch } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
}));
mockNuxtImport('$fetch', () => mockFetch);

async function answer(
	url: string,
	init?: { method?: string; query?: Record<string, unknown>; body?: { roundId?: number } },
) {
	server.requests.push(requestKey(url, init));
	const roundId = Number(init?.query?.roundId);
	switch (url) {
		case '/api/events/1':
			if (server.eventReadFails) throw Object.assign(new Error('Unavailable'), { statusCode: 503 });
			return toWire({ ...createMockEvent({ id: 1, meleeEnabled: true }), talents: [] });
		case '/api/events/1/rounds':
			return server.rounds;
		case '/api/events/1/matches':
			return { matches: server.matchesByRound.get(roundId) ?? [] };
		case '/api/events/1/feature-match-assignments':
			return { featureMatchAssignments: server.assignmentsByRound.get(roundId) ?? [] };
		case '/api/events/1/melee/sync-round': {
			const round = server.rounds.find(({ id }) => id === init?.body?.roundId)!;
			return {
				round: { id: round.id, name: round.name },
				matchCount: 0,
				created: 0,
				updated: 0,
				staleDeleted: 0,
				warnings: [],
			};
		}
		default:
			return [];
	}
}

const storesLoading = ref(false);

mockNuxtImport('useRoute', () => () => route);
mockNuxtImport('useRouter', () => () => router);
mockNuxtImport('useEventPageLoading', () => () => ({
	eventId: ref(1),
	initialLoading: storesLoading,
	initialError: ref(null),
	retry: () => {},
}));
mockNuxtImport('watchDebounced', () => (source: any, callback: any) => watch(source, callback));

const NuxtLayoutStub = defineComponent({
	template: `
		<div>
			<div data-testid="actions"><slot name="actions" /></div>
			<div data-testid="toolbar"><slot name="toolbar" /></div>
			<slot />
		</div>
	`,
});

const UIEmptyStateStub = defineComponent({
	props: {
		title: {
			type: String,
			required: true,
		},
		description: {
			type: String,
			required: false,
		},
	},
	template:
		'<div data-testid="empty-state">{{ title }}|{{ description }}<slot name="actions" /></div>',
});

const MatchListStub = defineComponent({
	props: {
		matches: {
			type: Array,
			required: true,
		},
		featureMatchAssignments: {
			type: Array,
			default: () => [],
		},
	},
	template:
		'<div data-testid="match-list" :data-assignment-notes="featureMatchAssignments.map(assignment => assignment.note).join(\'|\')">Match list: {{ matches.map(match => match.id).join(",") }}</div>',
});

const UDashboardToolbarStub = defineComponent({
	template: '<div data-testid="toolbar-content"><slot name="left" /><slot name="right" /></div>',
});

const UButtonStub = defineComponent({
	props: {
		label: {
			type: String,
			required: false,
		},
	},
	template: '<button type="button"><slot />{{ label }}</button>',
});

const USelectMenuStub = defineComponent({
	props: {
		items: {
			type: Array,
			required: true,
		},
	},
	template: `
		<div data-testid="round-select">
			<div v-for="item in items" :key="item.value">
				{{ item.label }}|{{ item.disabled ? 'disabled' : 'enabled' }}
			</div>
		</div>
	`,
});

const UContainerStub = defineComponent({
	template: '<div data-testid="container"><slot /></div>',
});

const mountedPages: Array<ReturnType<typeof mount>> = [];

/** Rounds the server holds, each named by its id, and the Round store holds as loaded. */
function holdRounds(rounds: Array<Partial<Parameters<typeof createWireMockRound>[0]>>) {
	server.rounds = rounds.map((round) =>
		createWireMockRound({ phaseId: 1, name: `Round ${round?.id}`, ...round }),
	) as Wired[];
	useRoundStore().rounds = structuredClone(server.rounds) as never;
}

function holdMatches(roundId: number, ids: number[], overrides: Partial<Wired>[] = []) {
	server.matchesByRound.set(
		roundId,
		ids.map((id, index) => toWire(createMockMatch({ id, roundId, ...overrides[index] })) as Wired),
	);
}

async function mountPage() {
	const pagePath = '../../../../../app/pages/event/[eventId]/matches.vue';
	const { default: MatchesPage } = await import(pagePath);

	const wrapper = mount(MatchesPage, {
		global: {
			stubs: {
				NuxtLayout: NuxtLayoutStub,
				UIEmptyState: UIEmptyStateStub,
				UDashboardToolbar: UDashboardToolbarStub,
				UContainer: UContainerStub,
				UButton: UButtonStub,
				USelectMenu: USelectMenuStub,
				UISearchInput: true,
				MatchList: MatchListStub,
			},
		},
	});
	mountedPages.push(wrapper);
	return wrapper;
}

/** The reads of Matches the page sent, by their query. */
const matchReads = () => server.requests.filter((request) => request.includes('/matches'));

async function syncFromEmptyState(wrapper: ReturnType<typeof mount>) {
	await wrapper
		.get('[data-testid="empty-state"]')
		.findAll('button')
		.find((button) => button.text().includes('Sync Matches'))!
		.trigger('click');
	await flushPromises();
}

describe('matches page', () => {
	beforeEach(() => {
		for (const key of Object.keys(route.query)) delete route.query[key];
		buildFullPath();
		resetAllEventStores();
		useEventStore().event = createMockEvent({ id: 1 }) as never;
		server.rounds = [];
		server.matchesByRound.clear();
		server.assignmentsByRound.clear();
		server.eventReadFails = false;
		server.requests = [];
		mockFetch.mockReset();
		mockFetch.mockImplementation(answer);
		useToast().clear();
		storesLoading.value = false;
	});

	afterEach(() => {
		for (const wrapper of mountedPages.splice(0)) wrapper.unmount();
	});

	it('shows the rounds setup empty state when no rounds exist', async () => {
		const wrapper = await mountPage();
		await flushPromises();

		expect(wrapper.get('[data-testid="empty-state"]').text()).toContain(
			'Set up rounds before creating matches.',
		);
		expect(wrapper.get('[data-testid="empty-state"]').text()).toContain('Set Up Structure');
	});

	it('shows an empty state when rounds exist but none of them have matches', async () => {
		holdRounds([{ id: 2 }]);

		const wrapper = await mountPage();
		await flushPromises();

		expect(wrapper.get('[data-testid="empty-state"]').text()).toContain(
			'Create a match to get started.',
		);
	});

	it('prefers the most recently synced round when no query or current round exists', async () => {
		holdRounds([
			{ id: 2, lastSyncedAt: new Date('2026-04-10T10:00:00.000Z') },
			{ id: 3, lastSyncedAt: new Date('2026-04-10T11:00:00.000Z') },
			{ id: 4, lastSyncedAt: null },
		]);
		holdMatches(2, [21]);
		holdMatches(3, [31]);
		holdMatches(4, [41]);

		const wrapper = await mountPage();
		await flushPromises();

		expect(wrapper.get('[data-testid="match-list"]').text()).toBe('Match list: 31');
	});

	it('shows all matches for the selected round', async () => {
		holdRounds([{ id: 2 }]);
		holdMatches(2, [11, 12, 13], [{ hasResult: false }, { hasResult: true }, { isBye: true }]);

		const wrapper = await mountPage();
		await flushPromises();

		expect(wrapper.get('[data-testid="toolbar"]').text()).toContain('3 Matches');
		expect(wrapper.get('[data-testid="match-list"]').text()).toContain('Match list: 11,12,13');
	});

	it("shows only the viewed Round's Assignments, and stops following that Round once it unmounts", async () => {
		route.query.roundId = '3';
		buildFullPath();
		holdRounds([{ id: 2 }, { id: 3 }]);
		holdMatches(3, [13]);
		server.assignmentsByRound.set(2, [{ id: 20, roundId: 2, note: 'Wrong Round' }]);
		server.assignmentsByRound.set(3, [{ id: 30, roundId: 3, note: 'Selected Round Note' }]);

		const wrapper = await mountPage();
		await flushPromises();

		expect(wrapper.get('[data-testid="match-list"]').attributes('data-assignment-notes')).toBe(
			'Selected Round Note',
		);

		wrapper.unmount();
		server.requests = [];
		await useFeatureMatchAssignmentStore().reloadConsumedRounds();
		expect(server.requests).toEqual([]);
	});

	it('makes no Event-wide Match list request on load', async () => {
		holdRounds([{ id: 2 }]);

		await mountPage();
		await flushPromises();

		expect(matchReads()).toEqual(['GET /api/events/1/matches?roundId=2']);
	});

	it('holds the loading state and the Round choice until the Rounds load, then keeps the queried Round', async () => {
		route.query.roundId = '3';
		buildFullPath();
		storesLoading.value = true;
		holdMatches(2, [21]);
		holdMatches(3, [31]);

		const wrapper = await mountPage();
		await flushPromises();

		expect(wrapper.find('[data-testid="empty-state"]').exists()).toBe(false);
		expect(route.fullPath).toBe('/event/1/matches?roundId=3');

		holdRounds([
			{ id: 2, lastSyncedAt: new Date('2026-04-10T11:00:00.000Z') },
			{ id: 3, lastSyncedAt: null },
		]);
		storesLoading.value = false;
		await flushPromises();

		expect(route.fullPath).toBe('/event/1/matches?roundId=3');
		expect(wrapper.get('[data-testid="match-list"]').text()).toBe('Match list: 31');
	});

	describe('a Round sync from its empty state', () => {
		beforeEach(() => {
			useEventStore().event = createMockEvent({ id: 1, meleeEnabled: true }) as never;
			holdRounds([{ id: 2, externalSource: 'melee' }]);
		});

		it("re-reads the synced Round's Matches and the Rounds, without an Event-wide Match list", async () => {
			const wrapper = await mountPage();
			await flushPromises();
			holdMatches(2, [21, 22]);
			server.requests = [];

			await syncFromEmptyState(wrapper);

			expect(wrapper.get('[data-testid="match-list"]').text()).toBe('Match list: 21,22');
			expect(server.requests).toEqual(
				expect.arrayContaining([
					'POST /api/events/1/melee/sync-round',
					'GET /api/events/1/rounds',
					'GET /api/events/1/matches?roundId=2',
				]),
			);
			expect(matchReads().every((request) => request.includes('?roundId='))).toBe(true);
		});

		it('tells the operator what the Melee store recorded of a Round sync, as the Sync page does', async () => {
			server.eventReadFails = true;
			const wrapper = await mountPage();
			await flushPromises();

			await syncFromEmptyState(wrapper);

			expect(useToast().toasts.value.map(({ title, color }) => ({ title, color }))).toEqual([
				{ title: 'Round Synced — Reload Needed', color: 'warning' },
			]);
		});
	});
});
