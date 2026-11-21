import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { h } from 'vue';
import { deferred } from '@keepr/nuxt-layer/test/helpers/deferred';
import { screenSettingsPage, seedThemedScreen } from '~~/test/nuxt/helpers/screenThemeOverrides';
import { getScreenModeSettingsComponent } from '~/modules/screen-mode';

/*
 * A Screen's settings page on the real Nuxt UI, the real stores and the real
 * config write, faking only the network: a switch flipped shows what it opens
 * and writes the Screen's new config.
 */

const { mockFetch } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
}));
mockNuxtImport('$fetch', () => mockFetch);

/** Every read answers empty; every write stays out. */
function fakeNetwork() {
	mockFetch.mockReset();
	mockFetch.mockImplementation(async (url: string, init?: { method?: string }) => {
		if (init?.method) return deferred().promise;
		if (url === '/api/themes/brand') {
			return {
				id: 'brand',
				name: 'Brand',
				tokens: {},
				revision: 1,
				createdAt: new Date(0),
				updatedAt: new Date(0),
			};
		}
		return [];
	});
}

/** What each config write sent for the Round Clock mode. */
function configWrites() {
	return mockFetch.mock.calls
		.filter(([url]) => String(url).endsWith('/config/round-clock'))
		.map(([, init]) => {
			const { stateVersion: _version, ...config } = init.body;
			return config;
		});
}

async function mountRoundClockSettings() {
	fakeNetwork();
	const screen = seedThemedScreen('round-clock');
	const Settings = getScreenModeSettingsComponent('round-clock')!;
	await (Settings as { __asyncLoader?: () => Promise<unknown> }).__asyncLoader?.();
	const wrapper = await mountSuspended(
		screenSettingsPage(screen, () => h(Settings, { screen: screen(), eventId: 1 })),
	);
	await flushPromises();
	return { wrapper };
}

describe("a Round Clock Screen's settings on Nuxt UI", () => {
	it('opens the count-up limit once counting up after the end is switched on, and writes it', async () => {
		const { wrapper } = await mountRoundClockSettings();
		const countUp = () =>
			wrapper
				.findAll('button[role="switch"]')
				.find((control) =>
					control.element
						.closest('[data-settings-field]')
						?.textContent?.includes('Count up after the end'),
				)!;
		const limitShown = () => wrapper.text().includes('Count-up limit (minutes)');
		expect([countUp().attributes('aria-checked'), limitShown()]).toEqual(['false', false]);

		await countUp().trigger('click');
		await flushPromises();

		expect([countUp().attributes('aria-checked'), limitShown()]).toEqual(['true', true]);
		await vi.waitFor(() => expect(configWrites()).toEqual([{ countUpAfterEnd: true }]));
	});
});
