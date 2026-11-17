import { mockNuxtImport, registerEndpoint } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nuxtUiStubs } from '@keepr/nuxt-layer/test/nuxt/helpers/nuxtUiStubs';
import FirstAdministratorPage from '~/pages/first-administrator.vue';

// The page shows the address its claim is for and sends the name and password
// chosen to claim it; the rules are the server's.

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn<(to: string) => void>() }));
mockNuxtImport('navigateTo', () => navigate);

const received: Record<string, unknown[]> = {};
let claimAnswer: { status: number; body: unknown };

function route(path: string, answer: () => { status: number; body: unknown }) {
	registerEndpoint(path, {
		method: 'POST',
		handler: async (event) => {
			const { readBody, setResponseStatus } = await import('h3');
			(received[path] ??= []).push(await readBody(event));
			const { status, body } = answer();
			setResponseStatus(event, status);
			return body;
		},
	});
}

route('/api/first-administrator/offer', () => ({
	status: 200,
	body: { email: 'founder@keepr.digital' },
}));
route('/api/first-administrator/claim', () => claimAnswer);

async function claim() {
	window.history.replaceState(null, '', '/first-administrator#claim=the-claim');
	const page = mount(FirstAdministratorPage, { global: { stubs: nuxtUiStubs } });
	await expect.poll(() => page.find('[data-claim]').exists()).toBe(true);
	await page.find('input[autocomplete="name"]').setValue('Founder');
	for (const input of page.findAll('input[type="password"]'))
		await input.setValue('a-brand-new-password');
	await page.find('form').trigger('submit');
	await flushPromises();
	// Settled once it has gone on to the profile or said why not.
	await expect
		.poll(() => navigate.mock.calls.length > 0 || page.find('[data-refusal]').exists())
		.toBe(true);
	return page;
}

beforeEach(() => {
	for (const path of Object.keys(received)) delete received[path];
	claimAnswer = { status: 200, body: { claimed: true } };
});

describe('the first-administrator page', () => {
	it('claims with the claim in its link, then drops it and goes to the profile', async () => {
		const page = await claim();

		expect(received['/api/first-administrator/offer']).toEqual([{ claimId: 'the-claim' }]);
		expect(page.get('[data-claim]').text()).toContain('founder@keepr.digital');
		expect(received['/api/first-administrator/claim']).toEqual([
			{ claimId: 'the-claim', name: 'Founder', password: 'a-brand-new-password' },
		]);
		expect(window.location.hash).toBe('');
		expect(navigate).toHaveBeenCalledWith('/');
	});

	it('says why the claim was refused', async () => {
		claimAnswer = { status: 409, body: { code: 'KEEPR_ADMINISTRATOR_EXISTS', message: 'exists' } };

		const page = await claim();

		expect(page.get('[data-refusal]').text()).toContain('a Keepr Administrator exists');
		expect(navigate).not.toHaveBeenCalled();
	});
});
