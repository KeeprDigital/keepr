import { mockNuxtImport, registerEndpoint } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nuxtUiStubs } from '@keepr/nuxt-layer/test/nuxt/helpers/nuxtUiStubs';
import InvitationPage from '~/pages/invitation.vue';

// The page shows the offer its link names, or why it is closed, and sends the
// invitee's answer: accept, as a new User or signed in, or decline. The rules are
// the server's.

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn<(to: string) => void>() }));
mockNuxtImport('navigateTo', () => navigate);

const INVITEE = 'newcomer@example.com';

const received: Record<string, unknown[]> = {};
let offerAnswer: { status: number; body: unknown };
let acceptAnswer: { status: number; body: unknown };
let session: unknown;

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

const ok = (body: unknown) => () => ({ status: 200, body });

route('/api/invitation/offer', () => offerAnswer);
route('/api/invitation/accept', () => acceptAnswer);
route('/api/invitation/decline', ok({ declined: true }));
route('/api/auth/organization/accept-invitation', ok({ invitation: {}, member: {} }));
registerEndpoint('/api/auth/get-session', { method: 'GET', handler: () => session });

function offer(hasUser: boolean) {
	return {
		status: 200,
		body: {
			email: INVITEE,
			organisationName: 'Keepr',
			inviterName: 'Ada',
			role: 'member',
			appRoles: { stream: 'admin' },
			hasUser,
		},
	};
}

function signedInAs(email: string) {
	session = { user: { name: 'Someone', email }, session: { token: 'token' } };
}

async function open(settled = '[data-offer]') {
	window.history.replaceState(null, '', '/invitation#id=the-invitation');
	const page = mount(InvitationPage, { global: { stubs: nuxtUiStubs } });
	await expect.poll(() => page.find(settled).exists()).toBe(true);
	await flushPromises();
	return page;
}

async function acceptAsNewUser(page: Awaited<ReturnType<typeof open>>) {
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
	offerAnswer = offer(false);
	acceptAnswer = { status: 200, body: { accepted: true } };
	session = null;
});

describe('the invitation page', () => {
	it('shows who invited whom, to which Organisation and App, from the id in its link', async () => {
		const page = await open();

		expect(received['/api/invitation/offer']).toEqual([{ invitationId: 'the-invitation' }]);
		expect(page.get('[data-offer]').text()).toContain('Ada has invited newcomer@example.com');
		expect(page.get('[data-app="stream"]').text()).toContain('Stream Keepr: admin');
	});

	it.each([
		['INVITATION_EXPIRED', 'has expired'],
		['INVITATION_CANCELLED', 'has been cancelled'],
	])('says plainly that it is closed, for %s', async (code, said) => {
		offerAnswer = { status: 410, body: { code, message: 'closed' } };

		const page = await open('[data-no-offer]');

		expect(page.get('[data-no-offer]').attributes('data-closed')).toBe(code);
		expect(page.get('[data-no-offer]').text()).toContain(said);
	});

	it('declines', async () => {
		const page = await open();

		await page.get('[data-decline]').trigger('click');

		await expect.poll(() => page.find('[data-declined]').exists()).toBe(true);
		expect(received['/api/invitation/decline']).toEqual([{ invitationId: 'the-invitation' }]);
	});
});

describe('an invitee with no User', () => {
	it('accepts with the name and password chosen, then goes to the profile', async () => {
		const page = await open();

		await acceptAsNewUser(page);

		expect(received['/api/invitation/accept']).toEqual([
			{ invitationId: 'the-invitation', name: 'Newcomer', password: 'a-brand-new-password' },
		]);
		expect(navigate).toHaveBeenCalledWith('/');
	});

	it('is told why acceptance was refused', async () => {
		acceptAnswer = { status: 400, body: { code: 'PASSWORD_TOO_SHORT', message: 'short' } };
		const page = await open();

		await acceptAsNewUser(page);

		expect(page.get('[data-refusal]').text()).toContain('at least 8 characters');
		expect(navigate).not.toHaveBeenCalled();
	});
});

describe('an invitee who has a User', () => {
	beforeEach(() => {
		offerAnswer = offer(true);
	});

	it('signs in and is brought back to the invitation', async () => {
		const page = await open('[data-has-user]');

		expect(page.get('[data-sign-in]').attributes('href')).toBe(
			`/sign-in?returnTo=${encodeURIComponent('/invitation#id=the-invitation')}`,
		);
		expect(page.find('[data-accept]').exists()).toBe(false);
	});

	it('signed in with the invited address, accepts, then goes to the profile', async () => {
		signedInAs(INVITEE);
		const page = await open('[data-accept]');

		await page.get('[data-accept]').trigger('click');

		await expect.poll(() => navigate.mock.calls).toEqual([['/']]);
		expect(received['/api/auth/organization/accept-invitation']).toEqual([
			{ invitationId: 'the-invitation' },
		]);
	});

	it('signed in with another address, is told the invitation is not theirs', async () => {
		signedInAs('someone-else@example.com');

		const page = await open('[data-other-user]');

		expect(page.get('[data-other-user]').text()).toContain('someone-else@example.com');
		expect(page.find('[data-accept]').exists()).toBe(false);
	});
});
