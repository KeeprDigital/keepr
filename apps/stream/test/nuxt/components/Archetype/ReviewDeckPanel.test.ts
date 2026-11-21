import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { nuxtUiStubs } from '@keepr/nuxt-layer/test/nuxt/helpers/nuxtUiStubs';
import ReviewDeckPanel from '~/components/Archetype/ReviewDeckPanel.vue';

mockNuxtImport('useScryfallBatch', () => () => ({
	fetchScryfallCards: vi.fn(async () => ({ cards: new Map(), degraded: false })),
}));

// A deck that could not be loaded says so and offers to load it again, rather
// than reading as a Player with no deck list.
describe('archetype review deck panel', () => {
	it.each([
		{ state: 'a failed load', error: 'This deck could not be loaded.', alerted: true },
		{ state: 'no deck list', error: null, alerted: false },
	])('shows $state', async ({ error, alerted }) => {
		const wrapper = mount(ReviewDeckPanel, {
			props: { entry: null, activeDeck: null, error, selectedKeyCards: new Set<string>() },
			global: { stubs: { ...nuxtUiStubs, UILoadingSpinner: true, MtgManaColorDisplay: true } },
		});

		const alert = wrapper.find('[role="alert"]');
		expect(alert.exists()).toBe(alerted);
		expect(wrapper.text().includes('No deck list available')).toBe(!alerted);
		if (alerted) {
			expect(alert.text()).toContain(error);
			await alert.get('button').trigger('click');
			expect(wrapper.emitted('retry')).toHaveLength(1);
		}
	});
});
