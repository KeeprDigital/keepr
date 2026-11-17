import { mockNuxtImport, registerEndpoint } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { nuxtUiStubs } from '@keepr/nuxt-layer/test/nuxt/helpers/nuxtUiStubs';
import IndexPage from '~/pages/index.vue';

// The page shows who the Session belongs to and signs it out; the rules are the server's.

const { navigate } = vi.hoisted(() => ({
	navigate: vi.fn<(to: string) => void>(),
}));
mockNuxtImport('navigateTo', () => navigate);

let session: unknown = null;
let signedOut = 0;
registerEndpoint('/api/auth/get-session', { method: 'GET', handler: () => session });
registerEndpoint('/api/auth/sign-out', {
	method: 'POST',
	handler: () => {
		signedOut++;
		return { success: true };
	},
});

describe('the home page', () => {
	it('names the signed-in User, and signs them out', async () => {
		session = { user: { name: 'Ada', email: 'ada@keepr.digital' } };
		const page = mount(IndexPage, { global: { stubs: nuxtUiStubs } });
		await vi.waitFor(() => expect(page.find('[data-signed-in]').exists()).toBe(true));

		expect(page.get('[data-signed-in] strong').text()).toBe('Ada');
		expect(page.get('[data-signed-in]').text()).toContain('ada@keepr.digital');

		await page.get('button').trigger('click');
		await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/sign-in'));
		expect(signedOut).toBe(1);
	});

	it('sends a visitor with no Session to sign in', async () => {
		session = null;
		mount(IndexPage, { global: { stubs: nuxtUiStubs } });

		await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/sign-in'));
	});
});
