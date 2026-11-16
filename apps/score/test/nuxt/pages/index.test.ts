import { ENGINE_VERSION as pairingVersion } from '@keepr/pairing';
import { ENGINE_VERSION as standingsVersion } from '@keepr/standings';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';
import IndexPage from '~/pages/index.vue';

describe('the placeholder page', () => {
	// The app reads each engine as a package of the workspace, from its source.
	it.each([
		['pairing', 'Pairing Engine', pairingVersion],
		['standings', 'Standings Engine', standingsVersion],
	])('names the %s engine and the version it reports', async (id, name, version) => {
		const page = await mountSuspended(IndexPage);
		const engine = page.get(`[data-engine="${id}"]`);

		expect(engine.get('dt').text()).toBe(name);
		expect(engine.get('dd').text()).toBe(version);
	});
});
