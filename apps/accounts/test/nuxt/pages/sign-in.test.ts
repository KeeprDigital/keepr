import { mockNuxtImport, registerEndpoint } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nuxtUiStubs } from '@keepr/nuxt-layer/test/nuxt/helpers/nuxtUiStubs';
import SignInPage from '~/pages/sign-in.vue';

// The page sends what is typed to Better Auth's sign-in and goes where the return
// address rule says; the rules themselves are tested at their homes.

const { navigate, route } = vi.hoisted(() => ({
	navigate: vi.fn<(to: string, options?: { external?: boolean }) => void>(),
	route: { query: {} as Record<string, string> },
}));
mockNuxtImport('navigateTo', () => navigate);
mockNuxtImport('useRoute', () => () => route);

const signIns: unknown[] = [];
let answer: { status: number; body: unknown } = { status: 200, body: {} };
registerEndpoint('/api/auth/sign-in/email', {
	method: 'POST',
	handler: async (event) => {
		const { readBody, setResponseStatus } = await import('h3');
		signIns.push(await readBody(event));
		setResponseStatus(event, answer.status);
		return answer.body;
	},
});

async function signIn(returnTo?: string) {
	route.query = returnTo === undefined ? {} : { returnTo };
	const page = mount(SignInPage, { global: { stubs: nuxtUiStubs } });
	await page.find('input[type="email"]').setValue('ada@keepr.digital');
	await page.find('input[type="password"]').setValue('a-long-enough-password');
	await page.find('form').trigger('submit');
	await flushPromises();
	return page;
}

beforeEach(() => {
	signIns.length = 0;
	answer = { status: 200, body: {} };
});

describe('the sign-in page', () => {
	it.each([
		[
			'the App it came from',
			'https://stream.keepr.digital/event/4',
			'https://stream.keepr.digital/event/4',
			true,
			false,
		],
		['its own home, when sent from outside Keepr', 'https://elsewhere.example/', '/', false, true],
	])('signs in and goes to %s', async (_case, returnTo, destination, external, warned) => {
		const page = await signIn(returnTo);
		await vi.waitFor(() => expect(navigate).toHaveBeenCalled());

		expect(signIns).toEqual([{ email: 'ada@keepr.digital', password: 'a-long-enough-password' }]);
		expect(navigate).toHaveBeenCalledWith(destination, { external });
		expect(page.find('[data-return-address="refused"]').exists()).toBe(warned);
	});

	it('shows the refusal it is given, and stays', async () => {
		answer = {
			status: 403,
			body: { code: 'BANNED_USER', message: 'This account has been disabled.' },
		};

		const page = await signIn();
		await vi.waitFor(() => expect(page.find('[data-refusal]').exists()).toBe(true));

		expect(page.get('[data-refusal]').text()).toBe('This account has been disabled.');
		expect(navigate).not.toHaveBeenCalled();
	});
});
