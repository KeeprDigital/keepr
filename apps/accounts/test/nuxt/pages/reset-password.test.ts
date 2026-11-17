import { registerEndpoint } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { nuxtUiStubs } from '@keepr/nuxt-layer/test/nuxt/helpers/nuxtUiStubs';
import ResetPasswordPage from '~/pages/reset-password.vue';

// The page hands the token in its address and the password typed to Better Auth's
// reset, and shows the outcome; the rules are the server's.

const resets: unknown[] = [];
let answer: { status: number; body: unknown } = { status: 200, body: { status: true } };
registerEndpoint('/api/auth/reset-password', {
	method: 'POST',
	handler: async (event) => {
		const { readBody, setResponseStatus } = await import('h3');
		resets.push(await readBody(event));
		setResponseStatus(event, answer.status);
		return answer.body;
	},
});

async function reset() {
	window.history.replaceState(null, '', '/reset-password#token=the-emailed-token');
	const page = mount(ResetPasswordPage, { global: { stubs: nuxtUiStubs } });
	await flushPromises();
	for (const input of page.findAll('input[type="password"]'))
		await input.setValue('a-brand-new-password');
	await page.find('form').trigger('submit');
	await flushPromises();
	return page;
}

beforeEach(() => {
	resets.length = 0;
	answer = { status: 200, body: { status: true } };
});

describe('the reset-password page', () => {
	it('sets the new password with the emailed token, and drops the token from the address', async () => {
		const page = await reset();

		await expect.poll(() => page.find('[data-reset]').exists()).toBe(true);
		expect(resets).toEqual([{ token: 'the-emailed-token', newPassword: 'a-brand-new-password' }]);
		expect(window.location.hash).toBe('');
	});

	it.each([
		[
			'a spent or expired link',
			{ code: 'INVALID_TOKEN', message: 'Invalid token' },
			'This link has expired or has been used.',
		],
		[
			'a refused password',
			{ code: 'PASSWORD_COMPROMISED', message: 'compromised' },
			'That password is known from a data breach',
		],
	])('says why it refused %s', async (_case, body, said) => {
		answer = { status: 400, body };

		const page = await reset();

		await expect.poll(() => page.find('[data-refusal]').exists()).toBe(true);
		expect(page.get('[data-refusal]').text()).toContain(said);
		expect(page.find('[data-reset]').exists()).toBe(false);
	});
});
