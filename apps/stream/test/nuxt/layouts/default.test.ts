import type { Game } from '~~/shared/types/enums';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, reactive } from 'vue';
import { UNavigationMenuStub } from '@keepr/nuxt-layer/test/nuxt/helpers/nuxtUiStubs';

vi.mock('~/composables/workflows/useEventLiveRefresh', () => ({
	useEventLiveRefresh: vi.fn(),
}));

const { mockClearPlayerDeckCache, mockNavigateTo, mockUser } = vi.hoisted(() => ({
	mockClearPlayerDeckCache: vi.fn(),
	mockNavigateTo: vi.fn(),
	mockUser: { value: null as { id: string; email: string; name: string } | null },
}));

// `identity` has to be a real ref for the layout to read through, and a
// hoisted factory cannot call `ref`; a computed over the hoisted container is
// both, and each test sets the container before it mounts.
vi.mock('~/modules/access/session', () => ({
	useAccess: () => ({
		identity: computed(() => (mockUser.value ? { user: mockUser.value } : null)),
	}),
}));

const mockEventStore = reactive({
	eventId: 1,
	event: {
		id: 1,
		name: 'Event One',
		game: 'mtg' as Game,
		meleeEnabled: true,
		meleeConfigured: true,
		initialSetupCompletedAt: null as Date | null,
	},
	$reset: vi.fn(),
});

const mockScreenStore = reactive({
	screens: [] as Array<{ id: number; name: string }>,
	loadScreensByEventId: vi.fn(),
	$reset: vi.fn(),
});

function mockResetStore() {
	return {
		$reset: vi.fn(),
	};
}
const mockPlayerStore = mockResetStore();
const mockArchetypeStore = mockResetStore();
const mockMetagameStore = mockResetStore();
const mockPlayerListStore = mockResetStore();
const mockPhaseStore = mockResetStore();
const mockRoundStore = mockResetStore();
const mockMatchStore = mockResetStore();
const mockFeatureMatchStore = mockResetStore();
const mockFeatureMatchAssignmentStore = mockResetStore();
const mockFeatureMatchStateStore = mockResetStore();
const mockCardStore = mockResetStore();
const mockMeleeStore = mockResetStore();
const mockColorMode = reactive({
	value: 'light',
	preference: 'light',
});

mockNuxtImport('useEventStore', () => () => mockEventStore);
mockNuxtImport('usePlayerStore', () => () => mockPlayerStore);
mockNuxtImport('useArchetypeStore', () => () => mockArchetypeStore);
mockNuxtImport('useMetagameStore', () => () => mockMetagameStore);
mockNuxtImport('usePlayerListStore', () => () => mockPlayerListStore);
mockNuxtImport('usePhaseStore', () => () => mockPhaseStore);
mockNuxtImport('useRoundStore', () => () => mockRoundStore);
mockNuxtImport('useMatchStore', () => () => mockMatchStore);
mockNuxtImport('useFeatureMatchStore', () => () => mockFeatureMatchStore);
mockNuxtImport('useFeatureMatchAssignmentStore', () => () => mockFeatureMatchAssignmentStore);
mockNuxtImport('useFeatureMatchStateStore', () => () => mockFeatureMatchStateStore);
mockNuxtImport('useScreenStore', () => () => mockScreenStore);
mockNuxtImport('useCardStore', () => () => mockCardStore);
mockNuxtImport('useMeleeStore', () => () => mockMeleeStore);
mockNuxtImport('useColorMode', () => () => mockColorMode);
mockNuxtImport('useRoute', () => () => ({
	meta: { title: 'Dashboard' },
	path: '/event/1',
	query: {},
}));
mockNuxtImport('clearPlayerDeckCache', () => mockClearPlayerDeckCache);
mockNuxtImport('navigateTo', () => mockNavigateTo);

const UDashboardGroupStub = defineComponent({
	template: '<div><slot /></div>',
});

const UDashboardSidebarStub = defineComponent({
	template:
		'<aside><slot name="header" :collapsed="false" /><slot :collapsed="false" /><slot name="footer" :collapsed="false" /></aside>',
});

const UDashboardPanelStub = defineComponent({
	template: '<main><slot name="header" /><slot /></main>',
});

const UButtonStub = defineComponent({
	props: {
		label: {
			type: String,
			required: false,
		},
	},
	template: '<button type="button"><slot>{{ label }}</slot></button>',
});

/** The navbar's own slots, and whether it would offer the mobile sidebar toggle. */
const UDashboardNavbarStub = defineComponent({
	props: {
		toggle: { type: Boolean, default: true },
	},
	template:
		'<header data-testid="navbar" :data-toggle="String(toggle)"><slot name="leading" /><slot /><slot name="right" /></header>',
});

async function mountLayout(props: Record<string, unknown> = {}) {
	const layoutPath = '../../../../app/layouts/default.vue';
	const { default: DefaultLayout } = await import(layoutPath);

	return mount(DefaultLayout, {
		props,
		slots: {
			default: '<div>Page Body</div>',
		},
		global: {
			stubs: {
				UDashboardGroup: UDashboardGroupStub,
				UDashboardSidebar: UDashboardSidebarStub,
				UDashboardPanel: UDashboardPanelStub,
				UDashboardNavbar: UDashboardNavbarStub,
				UDashboardSidebarCollapse: true,
				UIRealtimeStatus: true,
				UNavigationMenu: UNavigationMenuStub,
				USeparator: true,
				UIServerTimeStatus: true,
				UButton: UButtonStub,
			},
		},
	});
}

describe('default layout sync navigation', () => {
	beforeEach(() => {
		mockEventStore.eventId = 1;
		mockEventStore.event = {
			id: 1,
			name: 'Event One',
			game: 'mtg',
			meleeEnabled: true,
			meleeConfigured: true,
			initialSetupCompletedAt: null,
		};
		mockScreenStore.screens = [];
		mockScreenStore.loadScreensByEventId.mockReset();
		mockEventStore.$reset.mockReset();
		mockPlayerStore.$reset.mockReset();
		mockArchetypeStore.$reset.mockReset();
		mockMetagameStore.$reset.mockReset();
		mockPlayerListStore.$reset.mockReset();
		mockPhaseStore.$reset.mockReset();
		mockRoundStore.$reset.mockReset();
		mockMatchStore.$reset.mockReset();
		mockFeatureMatchStore.$reset.mockReset();
		mockFeatureMatchAssignmentStore.$reset.mockReset();
		mockFeatureMatchStateStore.$reset.mockReset();
		mockCardStore.$reset.mockReset();
		mockMeleeStore.$reset.mockReset();
		mockClearPlayerDeckCache.mockReset();
	});

	it('shows sync navigation before initial setup is complete', async () => {
		const wrapper = await mountLayout();

		expect(wrapper.text()).toContain('Sync');
	});

	it.each([
		['mtg', false],
		['op', true],
	] as const)('on a %s Event without Melee, offers Sync: %s', async (game, offered) => {
		Object.assign(mockEventStore.event, { game, meleeEnabled: false, meleeConfigured: false });

		const wrapper = await mountLayout();
		const items = wrapper
			.findAll('[data-nav-item]')
			.map((item) => item.attributes('data-nav-item'));

		expect(items.includes('Sync')).toBe(offered);
	});

	// An OP Event models no Rounds or Matches and never runs Melee Sync
	// (ADR-0057), so the pages for them are not offered.
	const TWO_PLAYER_MAGIC_ONLY_ENTRIES = [
		'Matches',
		'Archetype Review',
		'Event Structure',
		'Integrations',
	];

	it.each([
		['mtg', TWO_PLAYER_MAGIC_ONLY_ENTRIES, []],
		['op', [], TWO_PLAYER_MAGIC_ONLY_ENTRIES],
	] as const)('on a %s Event, offers %j and omits %j', async (game, offered, omitted) => {
		mockEventStore.event.game = game;

		const wrapper = await mountLayout();
		const items = wrapper
			.findAll('[data-nav-item]')
			.map((item) => item.attributes('data-nav-item'));

		expect(items).toEqual(
			expect.arrayContaining([
				...offered,
				'Controls',
				'Players',
				'Metagame',
				'Feature Matches',
				'Cards',
				'Screens',
				'Event',
				'Broadcast',
			]),
		);
		for (const label of omitted) expect(items).not.toContain(label);
	});

	// A Commander Event has no Players (ADR-0087); which pages it is offered is the offering table's.
	it('on a Commander Event, omits Players and keeps Cards', async () => {
		Object.assign(mockEventStore.event, { game: 'mtg', variant: 'commander' });

		const wrapper = await mountLayout();
		const items = wrapper
			.findAll('[data-nav-item]')
			.map((item) => item.attributes('data-nav-item'));

		expect(items).toContain('Cards');
		expect(items).not.toContain('Players');
	});

	// An MTG Event's Players come from Melee, an OP Event's from a TCG+ Import (ADR-0074).
	it.each([
		['mtg', false],
		['op', true],
	] as const)('on a %s Event without Melee, offers the Metagame: %s', async (game, offered) => {
		mockEventStore.event.game = game;
		mockEventStore.event.meleeEnabled = false;
		mockEventStore.event.meleeConfigured = false;

		const wrapper = await mountLayout();
		const items = wrapper
			.findAll('[data-nav-item]')
			.map((item) => item.attributes('data-nav-item'));

		expect(items.includes('Metagame')).toBe(offered);
	});
});

describe("default layout's account", () => {
	beforeEach(() => {
		mockUser.value = { id: 'usr_1', email: 'operator@example.test', name: 'Operator' };
	});

	it.each([
		['by name', 'Operator', 'Operator'],
		['by address when the name is blank', '', 'operator@example.test'],
	])(
		'names the signed-in User %s, so a shared machine says whose Session it is',
		async (_case, name, shown) => {
			mockUser.value = { id: 'usr_1', email: 'operator@example.test', name };

			const wrapper = await mountLayout();

			expect(wrapper.text()).toContain(shown);
		},
	);

	// A Session is every App's: it is ended at Keepr Accounts, never here.
	it('opens Keepr Accounts for the account, and offers no sign-out of its own', async () => {
		const wrapper = await mountLayout();

		expect(wrapper.find('[data-nav-item="Keepr account"]').attributes('href')).toBe(
			'https://accounts.keepr.digital',
		);
		expect(wrapper.find('[data-nav-item="Sign out"]').exists()).toBe(false);
	});
});

/**
 * Editor Focus Mode (#744): a page whose graphics editor wants the width hides
 * the app sidebar entirely, keeping the connection statuses its footer carried.
 */
describe('default layout Editor Focus Mode', () => {
	it('shows the app sidebar outside Focus Mode', async () => {
		const wrapper = await mountLayout();

		expect(wrapper.find('aside').exists()).toBe(true);
		expect(wrapper.get('[data-testid="navbar"]').find('u-i-realtime-status-stub').exists()).toBe(
			false,
		);
	});

	it('hides the app sidebar and its toggles in Focus Mode, keeping the connection statuses in the navbar', async () => {
		const wrapper = await mountLayout({ editorFocus: true });

		expect(wrapper.find('aside').exists()).toBe(false);
		expect(wrapper.find('u-dashboard-sidebar-collapse-stub').exists()).toBe(false);

		const navbar = wrapper.get('[data-testid="navbar"]');
		expect(navbar.attributes('data-toggle')).toBe('false');
		expect(navbar.find('u-i-realtime-status-stub').exists()).toBe(true);
		expect(navbar.find('u-i-server-time-status-stub').exists()).toBe(true);
	});
});
