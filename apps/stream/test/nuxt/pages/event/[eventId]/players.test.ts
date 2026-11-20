import type { PropType } from 'vue';
import type { Deferred } from '@keepr/nuxt-layer/test/helpers/deferred';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import { deferred } from '@keepr/nuxt-layer/test/helpers/deferred';
import { nuxtUiStubs } from '@keepr/nuxt-layer/test/nuxt/helpers/nuxtUiStubs';
import {
	createMockEvent,
	createWireMockPlayer,
	createWireMockRound,
} from '~~/test/helpers/fixtures';

interface StandingsAnswer {
	standings: Array<{
		playerId: number;
		wins: number;
		losses: number;
		draws: number;
		position: number;
		points: number;
	}>;
}

const { mockFetch } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
}));
mockNuxtImport('$fetch', () => mockFetch);

vi.mock('~/modules/event-data/resync', async (importOriginal) => ({
	...(await importOriginal<typeof import('~/modules/event-data/resync')>()),
	useConsumedEventData: () => {},
}));

const rounds = [
	createWireMockRound({ id: 3, phaseId: 1, name: 'Round 3', roundNumber: 3 }),
	createWireMockRound({ id: 4, phaseId: 1, name: 'Round 4', roundNumber: 4 }),
];

/** Event 1 with Alice, 9-0, and two Rounds, as the stores hold them once loaded. */
function holdEvent({ meleeEnabled = false } = {}) {
	resetAllEventStores();
	useEventStore().event = createMockEvent({ id: 1, game: 'mtg', meleeEnabled }) as never;
	usePlayerStore().players = [
		createWireMockPlayer({
			id: 41,
			name: 'Alice',
			wins: 9,
			losses: 0,
			draws: 0,
			position: 1,
			points: 27,
		}),
	] as never;
	useRoundStore().rounds = structuredClone(rounds) as never;
}

mockNuxtImport('useOverlay', () => () => ({
	create: vi.fn(),
}));
mockNuxtImport('usePlayerDeckListModal', () => () => ({
	openPlayerDeckList: vi.fn(),
}));
mockNuxtImport('usePlayerEditModal', () => () => ({
	openPlayerEdit: vi.fn(),
}));
mockNuxtImport('usePlayerMatchHistoryLink', () => () => {});
mockNuxtImport('useSendDeckToScreen', () => () => ({
	sendToFirstDeckScreen: vi.fn(),
	sendToScreen: vi.fn(),
}));
mockNuxtImport('useSendPlayerHistoryToScreen', () => () => ({
	sendToFirstPlayerHistoryScreen: vi.fn(),
	sendToScreen: vi.fn(),
}));
mockNuxtImport('useEventPageLoading', () => () => ({
	eventId: ref(1),
	initialLoading: ref(false),
	initialError: ref(null),
	retry: vi.fn(),
}));

const CollectionPageStub = defineComponent({
	template: '<div><slot name="toolbar" /><slot /></div>',
});

const ToolbarStub = defineComponent({
	template: '<div><slot name="left" /><slot name="right" /></div>',
});

/** The Round picker as one button per option. */
const RoundSelectStub = defineComponent({
	props: {
		items: {
			type: Array as PropType<Array<{ label: string; value: number | undefined }>>,
			default: () => [],
		},
	},
	emits: ['update:modelValue'],
	template: `<div>
		<button
			v-for="item in items"
			:key="item.label"
			type="button"
			:data-round="item.value ?? 'current'"
			@click="$emit('update:modelValue', item.value)"
		/>
	</div>`,
});

/** The table, as each Player's record: what the Round picker changes. */
const PlayerListStub = defineComponent({
	props: {
		players: {
			type: Array as PropType<Array<{ id: number; wins: number | null; losses: number | null }>>,
			default: () => [],
		},
	},
	setup: () => ({ selectedPlayerIds: [] }),
	template:
		'<ul><li v-for="player in players" :key="player.id" :data-player-record="player.id">{{ player.wins }}-{{ player.losses }}</li></ul>',
});

async function mountPage(stubs: Record<string, unknown> = {}) {
	const pagePath = '../../../../../app/pages/event/[eventId]/players.vue';
	const { default: PlayersPage } = await import(pagePath);
	return mount(PlayersPage, {
		global: {
			stubs: {
				UICollectionPage: CollectionPageStub,
				UDashboardToolbar: ToolbarStub,
				USelectMenu: RoundSelectStub,
				PlayerList: PlayerListStub,
				PlayerListTabs: true,
				UISearchInput: true,
				UIInitialLoadError: true,
				UAlert: true,
				UButton: true,
				...stubs,
			},
		},
	});
}

function standingsFor(wins: number): StandingsAnswer {
	return {
		standings: [
			{
				playerId: 41,
				wins,
				losses: 0,
				draws: 0,
				position: 1,
				points: wins * 3,
			},
		],
	};
}

describe('players page — Round Standings', () => {
	let wrapper: Awaited<ReturnType<typeof mountPage>> | null = null;
	let reads: Map<string, Deferred<StandingsAnswer>>;

	beforeEach(() => {
		holdEvent();
		reads = new Map();
		mockFetch.mockReset();
		mockFetch.mockImplementation((path: string) => {
			const read = deferred<StandingsAnswer>();
			reads.set(path, read);
			return read.promise;
		});
	});

	afterEach(() => {
		wrapper?.unmount();
		wrapper = null;
	});

	// Only the Round picked last may fill the table, whichever read answers last.
	it.each([
		{
			answered: 'in the order picked',
			order: [3, 4],
		},
		{
			answered: 'out of order',
			order: [4, 3],
		},
	])('shows the Round picked last when the reads answer $answered', async ({ order }) => {
		wrapper = await mountPage();

		await wrapper.get('[data-round="3"]').trigger('click');
		await wrapper.get('[data-round="4"]').trigger('click');
		for (const roundId of order) {
			reads.get(`/api/events/1/standings?roundId=${roundId}`)!.resolve(standingsFor(roundId));
			await flushPromises();
		}

		expect(wrapper.get('[data-player-record="41"]').text()).toBe('4-0');
	});

	// Back to "Current" is a pick too: a Round's late answer must not be kept for the next Round.
	it('shows current records once "Current" is picked over a Round still being read', async () => {
		wrapper = await mountPage();

		await wrapper.get('[data-round="3"]').trigger('click');
		await wrapper.get('[data-round="current"]').trigger('click');
		reads.get('/api/events/1/standings?roundId=3')!.resolve(standingsFor(3));
		await flushPromises();
		await wrapper.get('[data-round="4"]').trigger('click');

		expect(wrapper.get('[data-player-record="41"]').text()).toBe('9-0');
	});
});

// The Players page starts a Round sync from the alert over a Round with no standings.
describe('players page — Round sync', () => {
	let wrapper: Awaited<ReturnType<typeof mountPage>> | null = null;
	/** Every write the server was sent, and whether its Event re-read fails after one. */
	let writes: Array<[string, unknown]>;
	let eventReadFails: boolean;

	beforeEach(() => {
		holdEvent({ meleeEnabled: true });
		useRoundStore().rounds[0]!.externalSource = 'melee';
		writes = [];
		eventReadFails = false;
		useToast().clear();
		mockFetch.mockReset();
		mockFetch.mockImplementation(
			async (path: string, init?: { method?: string; body?: unknown }) => {
				if (init?.method && init.method !== 'GET') {
					writes.push([`${init.method} ${path}`, init.body]);
					return {
						round: { id: 3, name: 'Round 3' },
						matchCount: 0,
						created: 0,
						updated: 0,
						staleDeleted: 0,
						warnings: [],
					};
				}
				if (path === '/api/events/1' && eventReadFails)
					throw Object.assign(new Error('Unavailable'), { statusCode: 503 });
				if (path.startsWith('/api/events/1/standings')) return { standings: [] };
				if (path === '/api/events/1') return createMockEvent({ id: 1, meleeEnabled: true });
				return [];
			},
		);
	});

	afterEach(() => {
		wrapper?.unmount();
		wrapper = null;
	});

	async function syncRoundThree() {
		wrapper = await mountPage({
			UAlert: defineComponent({ template: '<div><slot name="actions" /></div>' }),
			UButton: defineComponent({ template: '<button type="button"><slot /></button>' }),
		});
		await wrapper.get('[data-round="3"]').trigger('click');
		await flushPromises();

		await wrapper
			.findAll('button')
			.find((button) => button.text() === 'Sync Round')!
			.trigger('click');
		await flushPromises();
	}

	it('syncs the Round picked, and says so', async () => {
		await syncRoundThree();

		expect({
			writes,
			toasts: useToast().toasts.value.map(({ title, color }) => ({ title, color })),
		}).toEqual({
			writes: [['POST /api/events/1/melee/sync-round', { roundId: 3 }]],
			toasts: [{ title: 'Round Synced', color: 'success' }],
		});
	});

	it('tells the operator what the Melee store recorded of the sync, as the Sync page does', async () => {
		eventReadFails = true;

		await syncRoundThree();

		expect(useToast().toasts.value.map(({ title, color }) => ({ title, color }))).toEqual([
			{ title: 'Round Synced — Reload Needed', color: 'warning' },
		]);
	});
});

// A List whose members could not be read is not an empty List: the page says so and reads again.
describe('players page — a Player List it could not read', () => {
	it('says so and reads the members again on retry', async () => {
		holdEvent();
		const memberReads: string[] = [];
		mockFetch.mockReset();
		mockFetch.mockImplementation(async (path: string) => {
			if (path !== '/api/events/1/player-lists/7/member-ids') return await new Promise(() => {});
			memberReads.push(path);
			throw new Error('unreachable');
		});
		const wrapper = await mountPage({
			PlayerListTabs: defineComponent({
				emits: ['select'],
				template:
					'<button type="button" data-list-tab @click="$emit(\'select\', 7)">Top 8</button>',
			}),
			UAlert: nuxtUiStubs.UAlert,
		});

		await wrapper.get('[data-list-tab]').trigger('click');
		await flushPromises();
		const alert = wrapper.get('[role="alert"]');
		expect(alert.text()).toContain("This list's members could not be loaded.");

		await alert
			.findAll('button')
			.find((button) => button.text() === 'Retry')!
			.trigger('click');
		await flushPromises();
		expect(memberReads).toHaveLength(2);
		wrapper.unmount();
	});
});
