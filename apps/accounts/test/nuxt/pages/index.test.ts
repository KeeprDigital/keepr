import { mockNuxtImport, registerEndpoint } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nuxtUiStubs } from '@keepr/nuxt-layer/test/nuxt/helpers/nuxtUiStubs';
import IndexPage from '~/pages/index.vue';

// The profile: each part sends what the User did to Better Auth's route for it and
// shows the outcome; the rules are the server's.

const { navigate } = vi.hoisted(() => ({
	navigate: vi.fn<(to: string) => void>(),
}));
mockNuxtImport('navigateTo', () => navigate);

const THIS_BROWSER = 'token-of-this-browser';
const PHONE = 'token-of-the-phone';

let session: unknown;
let sessions: { token: string; userAgent: string; updatedAt: string }[];
const received: Record<string, unknown[]> = {};

/** What the server refuses a path's request with, answering 400, when a test says it does. */
const refusals: Record<string, { code: string; message: string }> = {};

function route(path: string, method: 'GET' | 'POST', answer: () => unknown) {
	registerEndpoint(`/api/auth${path}`, {
		method,
		handler: async (event) => {
			const { readBody, setResponseStatus } = await import('h3');
			(received[path] ??= []).push(method === 'POST' ? await readBody(event) : null);
			const refusal = refusals[path];
			if (!refusal) return answer();
			setResponseStatus(event, 400);
			return refusal;
		},
	});
}

route('/get-session', 'GET', () => session);
route('/list-sessions', 'GET', () => sessions);
route('/update-user', 'POST', () => ({ status: true }));
route('/change-password', 'POST', () => ({ token: null }));
route('/revoke-session', 'POST', () => ({ status: true }));
route('/sign-out', 'POST', () => ({ success: true }));
route('/organization/set-active', 'POST', () => {
	const { organizationId } = received['/organization/set-active']!.at(-1) as {
		organizationId: string;
	};
	organisations = { ...organisations, active: organizationId };
	return { id: organizationId };
});
registerEndpoint('/api/profile/organisations', { method: 'GET', handler: () => organisations });

const KEEPR = {
	id: 'keepr',
	name: 'Keepr',
	role: 'owner',
	apps: { stream: 'admin', score: 'member' },
};
const CLUB = { id: 'club', name: 'The Club', role: 'member', apps: {} };
let organisations: { active: string | null; organisations: unknown[] };

beforeEach(() => {
	organisations = { active: 'keepr', organisations: [KEEPR] };
	for (const path of Object.keys(refusals)) delete refusals[path];
	for (const path of Object.keys(received)) delete received[path];
	session = {
		user: { name: 'Ada', email: 'ada@keepr.digital' },
		session: { token: THIS_BROWSER },
	};
	sessions = [
		{ token: THIS_BROWSER, userAgent: 'Laptop browser', updatedAt: '2026-11-17T10:00:00.000Z' },
		{ token: PHONE, userAgent: 'Phone browser', updatedAt: '2026-11-16T10:00:00.000Z' },
	];
});

async function profile() {
	const page = mount(IndexPage, { global: { stubs: nuxtUiStubs } });
	await expect.poll(() => page.find('[data-signed-in]').exists()).toBe(true);
	await flushPromises();
	return page;
}

describe('the profile', () => {
	it('shows the name and saves a new one', async () => {
		const page = await profile();
		const name = page.get('[data-profile="name"] input');
		expect((name.element as HTMLInputElement).value).toBe('Ada');
		expect(page.get('[data-signed-in]').text()).toContain('ada@keepr.digital');

		await name.setValue('Ada Lovelace');
		await page.get('[data-profile="name"] form').trigger('submit');

		await expect.poll(() => page.find('[data-profile="name"] [data-saved]').exists()).toBe(true);
		expect(received['/update-user']).toEqual([{ name: 'Ada Lovelace' }]);
	});

	it('says a blank name is refused, beside the name', async () => {
		refusals['/update-user'] = { code: 'NAME_REQUIRED', message: 'from the server' };
		const page = await profile();

		await page.get('[data-profile="name"] input').setValue('  ');
		await page.get('[data-profile="name"] form').trigger('submit');

		await expect.poll(() => page.find('[data-profile="name"] [data-refusal]').exists()).toBe(true);
		expect(page.get('[data-profile="name"] [data-refusal]').text()).toContain('Enter your name');
		expect(page.find('[data-profile="name"] [data-saved]').exists()).toBe(false);
	});

	it('changes the password, signing out everywhere else', async () => {
		const page = await profile();
		const [current, next, confirmation] = page.findAll('[data-profile="password"] input');

		await current!.setValue('the-old-password');
		await next!.setValue('a-brand-new-password');
		await confirmation!.setValue('a-brand-new-password');
		await page.get('[data-profile="password"] form').trigger('submit');

		await expect
			.poll(() => page.find('[data-profile="password"] [data-saved]').exists())
			.toBe(true);
		expect(received['/change-password']).toEqual([
			{
				currentPassword: 'the-old-password',
				newPassword: 'a-brand-new-password',
				revokeOtherSessions: true,
			},
		]);
	});

	it('lists the active Sessions, and ends another one', async () => {
		const page = await profile();
		const rows = () => page.findAll('[data-profile="sessions"] [data-session]');
		expect(rows().map((row) => row.attributes('data-current'))).toEqual(['true', 'false']);
		expect(rows()[1]!.text()).toContain('Phone browser');

		sessions = sessions.filter((listed) => listed.token !== PHONE);
		await rows()[1]!.get('button').trigger('click');

		await expect.poll(() => rows().length).toBe(1);
		expect(received['/revoke-session']).toEqual([{ token: PHONE }]);
	});

	it('lists the Organisations with the Apps usable in each, and no switcher for one', async () => {
		const page = await profile();
		const rows = page.findAll('[data-profile="organisations"] [data-organisation]');

		expect(rows.map((row) => row.attributes('data-organisation'))).toEqual(['keepr']);
		expect(rows[0]!.text()).toContain('owner');
		expect(rows[0]!.text()).toContain('Stream Keepr: admin');
		expect(rows[0]!.text()).toContain('Score Keepr: member');
		expect(page.find('[data-organisation-switcher]').exists()).toBe(false);
	});

	it('switches the Organisation worked in, for a User in several', async () => {
		organisations = { active: 'keepr', organisations: [KEEPR, CLUB] };
		const page = await profile();
		const active = () =>
			page
				.findAll('[data-organisation]')
				.filter((row) => row.attributes('data-active') === 'true')
				.map((row) => row.attributes('data-organisation'));
		expect(active()).toEqual(['keepr']);

		await page.get('select[data-organisation-switcher]').setValue('club');

		await expect.poll(active).toEqual(['club']);
		expect(received['/organization/set-active']).toEqual([{ organizationId: 'club' }]);
	});

	// The screens a User may use are linked; the server still decides each.
	it.each<[string, string | undefined, string[]]>([
		[
			'an owner of the Organisation worked in, and a member of another',
			undefined,
			['/members?organisation=keepr', '/invite'],
		],
		['a Keepr Administrator', 'admin', ['/members?organisation=keepr', '/invite', '/platform']],
	])('links %s to the screens they may use', async (_who, role, links) => {
		organisations = { active: 'keepr', organisations: [KEEPR, CLUB] };
		session = { ...(session as object), user: { name: 'Ada', email: 'ada@keepr.digital', role } };

		const page = await profile();

		expect(page.findAll('a[data-manage]').map((link) => link.attributes('href'))).toEqual(links);
	});

	it('signs out', async () => {
		const page = await profile();

		await page.get('[data-sign-out]').trigger('click');

		await expect.poll(() => navigate.mock.calls).toEqual([['/sign-in']]);
		expect(received['/sign-out']).toHaveLength(1);
	});

	it('sends a visitor with no Session to sign in', async () => {
		session = null;
		mount(IndexPage, { global: { stubs: nuxtUiStubs } });

		await expect.poll(() => navigate.mock.calls).toEqual([['/sign-in']]);
	});
});
