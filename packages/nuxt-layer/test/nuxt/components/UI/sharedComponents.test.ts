import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';
import { defineComponent, h } from 'vue';
import CollectionPage from '../../../../app/components/UI/CollectionPage.vue';
import EmptyState from '../../../../app/components/UI/EmptyState.vue';
import InitialLoadError from '../../../../app/components/UI/InitialLoadError.vue';
import LoadingSpinner from '../../../../app/components/UI/LoadingSpinner.vue';
import SearchInput from '../../../../app/components/UI/SearchInput.vue';
import SegmentedTabs from '../../../../app/components/UI/SegmentedTabs.vue';
import { nuxtUiStubs } from '../../helpers/nuxtUiStubs';

const stubs = { global: { stubs: nuxtUiStubs } };

/** The app's layout, reduced to the regions a Collection Page fills. */
const NuxtLayoutStub = defineComponent({
	name: 'NuxtLayout',
	setup(_, { slots }) {
		return () =>
			h('div', [
				slots.actions && h('div', { 'data-region': 'actions' }, slots.actions()),
				slots.toolbar && h('div', { 'data-region': 'toolbar' }, slots.toolbar()),
				slots.default?.(),
			]);
	},
});

describe('CollectionPage', () => {
	async function mountPage(props: {
		state: 'loading' | 'ready' | 'empty' | 'empty-filtered';
		toolbarMode?: 'auto' | 'always' | 'never';
		reserveToolbarSpace?: boolean;
	}) {
		return await mountSuspended(CollectionPage, {
			props: { emptyIcon: 'i-lucide-tv', emptyTitle: 'No Screens yet', ...props },
			slots: {
				default: () => h('p', { 'data-content': '' }, 'the list'),
				actions: () => h('button', 'New Screen'),
				toolbar: () => h('input', { 'data-search': '' }),
				'empty-actions': () => h('button', 'Create the first'),
			},
			global: { stubs: { ...nuxtUiStubs, NuxtLayout: NuxtLayoutStub } },
		});
	}

	// What each state shows: content, the empty state, the toolbar and the page's actions.
	it.each([
		{ state: 'loading', mode: 'auto', content: true, empty: false, toolbar: false, actions: false },
		{ state: 'ready', mode: 'auto', content: true, empty: false, toolbar: true, actions: true },
		{ state: 'empty', mode: 'auto', content: false, empty: true, toolbar: false, actions: false },
		{
			state: 'empty-filtered',
			mode: 'auto',
			content: false,
			empty: true,
			toolbar: true,
			actions: false,
		},
		{ state: 'empty', mode: 'always', content: false, empty: true, toolbar: true, actions: false },
		{ state: 'ready', mode: 'never', content: true, empty: false, toolbar: false, actions: true },
	] as const)(
		'shows a $state page with the toolbar $mode',
		async ({ state, mode, content, empty, toolbar, actions }) => {
			const wrapper = await mountPage({ state, toolbarMode: mode });

			expect(wrapper.find('[data-content]').exists()).toBe(content);
			expect(wrapper.text().includes('No Screens yet')).toBe(empty);
			expect(wrapper.text().includes('Create the first')).toBe(empty);
			expect(wrapper.find('[data-search]').exists()).toBe(toolbar);
			expect(wrapper.text().includes('New Screen')).toBe(actions);
		},
	);

	// An empty page keeps the toolbar's height unless told not to, so the page does not jump.
	it.each([
		['keeps', true, true],
		['gives up', false, false],
	])('%s the toolbar space on an empty page', async (_label, reserveToolbarSpace, reserved) => {
		const wrapper = await mountPage({ state: 'empty', reserveToolbarSpace });

		expect(wrapper.find('[data-region="toolbar"] [aria-hidden="true"]').exists()).toBe(reserved);
	});
});

describe('EmptyState', () => {
	it.each([
		['page', 'Add one to begin.'],
		['card', 'Add one to begin.'],
		['inline', 'Add one to begin.'],
		['card', undefined],
	] as const)('names what is missing as a %s, described as %s', async (variant, description) => {
		const wrapper = await mountSuspended(EmptyState, {
			props: { icon: 'i-lucide-users', title: 'No Players', description, variant },
			slots: { actions: () => h('button', 'Import Players') },
			...stubs,
		});

		expect(wrapper.text()).toContain('No Players');
		expect(wrapper.text().includes('Add one to begin.')).toBe(description !== undefined);
		expect(wrapper.find('[data-icon="i-lucide-users"]').exists()).toBe(true);
		expect(wrapper.text()).toContain('Import Players');
	});
});

describe('InitialLoadError', () => {
	it('alerts with why the page could not load, and asks to retry', async () => {
		const wrapper = await mountSuspended(InitialLoadError, {
			props: { error: 'The server did not answer.' },
			...stubs,
		});

		expect(wrapper.get('[role="alert"]').text()).toContain('The server did not answer.');
		await wrapper.get('button').trigger('click');
		expect(wrapper.emitted('retry')).toHaveLength(1);
	});
});

describe('LoadingSpinner', () => {
	it.each([
		['with a label', 'Loading Players…', true],
		['without one', undefined, false],
	])('spins %s', async (_label, label, labelled) => {
		const wrapper = await mountSuspended(LoadingSpinner, { props: { label }, ...stubs });

		expect(wrapper.find('[data-icon="i-lucide-loader-2"]').exists()).toBe(true);
		expect(wrapper.text().includes('Loading Players…')).toBe(labelled);
	});
});

describe('SearchInput', () => {
	it.each([
		['offers no clear button while empty', '', false],
		['offers one once something is typed', 'ali', true],
	])('%s', async (_label, modelValue, clearable) => {
		const wrapper = await mountSuspended(SearchInput, { props: { modelValue }, ...stubs });

		expect(wrapper.find('[aria-label="Clear search"]').exists()).toBe(clearable);
	});

	it('reports what is typed, and clears it', async () => {
		const wrapper = await mountSuspended(SearchInput, {
			props: { modelValue: 'ali', ariaLabel: 'Search Players' },
			...stubs,
		});

		await wrapper.get('input[aria-label="Search Players"]').setValue('alice');
		await wrapper.get('[aria-label="Clear search"]').trigger('click');

		expect(wrapper.emitted('update:modelValue')).toEqual([['alice'], ['']]);
	});
});

describe('SegmentedTabs', () => {
	const items = [
		{ label: 'Players', value: 'players' },
		{ icon: 'i-lucide-grid', value: 'grid', ariaLabel: 'Grid view' },
		{ label: 'Archive', value: 'archive', disabled: true },
	];

	it('marks the chosen tab active and only it', async () => {
		const wrapper = await mountSuspended(SegmentedTabs, {
			props: { items, modelValue: 'grid' },
			...stubs,
		});

		expect(
			wrapper
				.findAll('[data-active]')
				.map((tab) => [tab.attributes('data-testid'), tab.attributes('data-active')]),
		).toEqual([
			['tab-players', 'false'],
			['tab-grid', 'true'],
			['tab-archive', 'false'],
		]);
		expect(wrapper.get('[data-testid="tab-grid"]').attributes('aria-label')).toBe('Grid view');
	});

	it.each([
		['chooses an enabled tab', 'tab-players', [['players']]],
		['cannot choose a disabled one', 'tab-archive', undefined],
	])('%s', async (_label, testId, emitted) => {
		const wrapper = await mountSuspended(SegmentedTabs, {
			props: { items, modelValue: 'grid' },
			...stubs,
		});

		await wrapper.get(`[data-testid="${testId}"]`).trigger('click');

		expect(wrapper.emitted('update:modelValue')).toEqual(emitted);
	});
});
