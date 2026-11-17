import { registerEndpoint } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { nuxtUiStubs } from '@keepr/nuxt-layer/test/nuxt/helpers/nuxtUiStubs';
import ForgotPasswordPage from '~/pages/forgot-password.vue';

// The page asks Better Auth to email a reset link to the address typed, and says
// what it says for every address; the rules are the server's.

const requests: unknown[] = [];
registerEndpoint('/api/auth/request-password-reset', {
	method: 'POST',
	handler: async (event) => {
		const { readBody } = await import('h3');
		requests.push(await readBody(event));
		return { status: true };
	},
});

describe('the forgotten-password page', () => {
	it('asks for a reset link for the address typed, and says one is on its way', async () => {
		const page = mount(ForgotPasswordPage, { global: { stubs: nuxtUiStubs } });
		await page.find('input[type="email"]').setValue('ada@keepr.digital');
		await page.find('form').trigger('submit');
		await flushPromises();

		await expect.poll(() => page.find('[data-requested]').exists()).toBe(true);
		expect(requests).toEqual([{ email: 'ada@keepr.digital' }]);
		expect(page.get('[data-requested]').text()).toContain('ada@keepr.digital');
	});
});
