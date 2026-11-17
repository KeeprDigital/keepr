import { mockNuxtImport, registerEndpoint } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nuxtUiStubs } from '@keepr/nuxt-layer/test/nuxt/helpers/nuxtUiStubs';
import InvitationPage from '~/pages/invitation.vue';

// The page shows the offer its link names and sends the name and password chosen
// to accept it; the rules are the server's.

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn<(to: string) => void>() }));
mockNuxtImport('navigateTo', () => navigate);

const received: Record<string, unknown[]> = {};
let acceptAnswer: { status: number; body: unknown };

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

route('/api/invitation/offer', () => ({
	status: 200,
	body: {
		email: 'newcomer@example.com',
		organisationName: 'Keepr',
		inviterName: 'Ada',
		role: 'member',
		appRoles: { stream: 'admin' },
		hasUser: false,
	},
}));
route('/api/invitation/accept', () => acceptAnswer);

async function open() {
	window.history.replaceState(null, '', '/invitation#id=the-invitation');
	const page = mount(InvitationPage, { global: { stubs: nuxtUiStubs } });
	await expect.poll(() => page.find('[data-offer]').exists()).toBe(true);
	return page;
}

async function accept(page: Awaited<ReturnType<typeof open>>) {
	await page.find('input[autocomplete="name"]').setValue('Newcomer');
	for (const input of page.findAll('input[type="password"]'))
		await input.setValue('a-brand-new-password');
	await page.find('form').trigger('submit');
	await flushPromises();
	// Settled once it has gone on to the profile or said why not.
	await expect
		.poll(() => navigate.mock.calls.length > 0 || page.find('[data-refusal]').exists())
		.toBe(true);
}

beforeEach(() => {
	for (const path of Object.keys(received)) delete received[path];
	acceptAnswer = { status: 200, body: { accepted: true } };
});

describe('the invitation page', () => {
	it('shows who invited whom, to which Organisation and App, from the id in its link', async () => {
		const page = await open();

		expect(received['/api/invitation/offer']).toEqual([{ invitationId: 'the-invitation' }]);
		expect(page.get('[data-offer]').text()).toContain('Ada has invited newcomer@example.com');
		expect(page.get('[data-app="stream"]').text()).toContain('Stream Keepr: admin');
	});

	it('accepts with the name and password chosen, then goes to the profile', async () => {
		const page = await open();

		await accept(page);

		expect(received['/api/invitation/accept']).toEqual([
			{ invitationId: 'the-invitation', name: 'Newcomer', password: 'a-brand-new-password' },
		]);
		expect(navigate).toHaveBeenCalledWith('/');
	});

	it('says why acceptance was refused', async () => {
		acceptAnswer = { status: 400, body: { code: 'PASSWORD_TOO_SHORT', message: 'short' } };
		const page = await open();

		await accept(page);

		expect(page.get('[data-refusal]').text()).toContain('at least 8 characters');
		expect(navigate).not.toHaveBeenCalled();
	});
});
