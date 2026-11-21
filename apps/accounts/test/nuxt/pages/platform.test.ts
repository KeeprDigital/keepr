import { mockNuxtImport, registerEndpoint } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nuxtUiStubs } from '@keepr/nuxt-layer/test/nuxt/helpers/nuxtUiStubs';
import PlatformPage from '~/pages/platform.vue';

// The platform screen sends what a Keepr Administrator does to Keepr Accounts'
// own routes and shows what they answer; who may, and every rule, is the server's.

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn<(to: string) => void>() }));
mockNuxtImport('navigateTo', () => navigate);

let organisationsAnswer: { status: number; body: unknown };
let createAnswer: { status: number; body: unknown };
let ada: {
	id: string;
	name: string;
	email: string;
	disabled: boolean;
	keeprAdministrator: boolean;
};
const sent: { method: string; path: string; body: unknown }[] = [];

/** A route at `path`, which records what it was sent (a body, or a query) and answers `answer()`. */
function route(
	method: 'GET' | 'POST',
	path: string,
	answer: () => { status: number; body: unknown },
) {
	registerEndpoint(path, {
		method,
		handler: async (event) => {
			const { getQuery, readBody, setResponseStatus } = await import('h3');
			sent.push({
				method,
				path,
				body: method === 'POST' ? await readBody(event) : getQuery(event),
			});
			const { status, body } = answer();
			setResponseStatus(event, status);
			return body;
		},
	});
}

const ok = (body: unknown) => ({ status: 200, body });

registerEndpoint('/api/auth/get-session', {
	method: 'GET',
	handler: () => ({ user: { name: 'Admin', role: 'admin' }, session: {} }),
});
route('GET', '/api/platform/organisations', () => organisationsAnswer);
route('POST', '/api/platform/organisations', () => createAnswer);
route('GET', '/api/platform/users', () => ok([ada]));
route('POST', '/api/platform/users/ada/disable', () => {
	ada = { ...ada, disabled: true };
	return ok({ disabled: true });
});
route('POST', '/api/platform/users/ada/keepr-administrator', () => {
	ada = { ...ada, keeprAdministrator: true };
	return ok({ keeprAdministrator: true });
});
route('GET', '/api/platform/audit-record', () =>
	ok([
		{
			id: 'row-1',
			at: '2026-11-17T10:00:00.000Z',
			action: 'user.disabled',
			actor: { id: 'admin', name: 'Admin', email: 'admin@keepr.digital' },
			subject: { id: 'ada', name: 'Ada', email: 'ada@keepr.digital' },
			organisation: null,
			detail: { sessionsEnded: 2 },
		},
	]),
);

beforeEach(() => {
	sent.length = 0;
	navigate.mockClear();
	organisationsAnswer = {
		status: 200,
		body: [{ id: 'club', name: 'The Club', createdAt: '2026-11-17T10:00:00.000Z', members: 3 }],
	};
	createAnswer = {
		status: 200,
		body: {
			organisation: { id: 'new', name: 'New Club' },
			invitationId: 'inv-1',
		},
	};
	ada = {
		id: 'ada',
		name: 'Ada',
		email: 'ada@keepr.digital',
		disabled: false,
		keeprAdministrator: false,
	};
});

async function opened() {
	const page = mount(PlatformPage, { global: { stubs: nuxtUiStubs } });
	await flushPromises();
	await expect
		.poll(() => page.find('[data-organisation]').exists() || page.find('[data-closed]').exists())
		.toBe(true);
	await flushPromises();
	return page;
}

/** What was sent to `path` by `method`. */
function sentTo(method: string, path: string) {
	return sent.filter((request) => request.method === method && request.path === path);
}

describe('the platform screen', () => {
	it('lists every Organisation, each linking to its members', async () => {
		const page = await opened();

		const club = page.get('[data-organisation="club"]');
		expect(club.text()).toContain('The Club');
		expect(club.get('a').attributes('href')).toBe('/members?organisation=club');
	});

	it('creates an Organisation, inviting its first owner, and says to whom it was emailed', async () => {
		const page = await opened();

		await page.get('[data-create] input[name="name"]').setValue('New Club');
		await page.get('[data-create] input[name="ownerEmail"]').setValue('owner@club.example');
		await page.get('[data-create] select[data-app="stream"]').setValue('admin');
		await page.get('[data-create] form').trigger('submit');
		await expect.poll(() => page.find('[data-created]').exists()).toBe(true);

		expect(sentTo('POST', '/api/platform/organisations').map(({ body }) => body)).toEqual([
			{ name: 'New Club', ownerEmail: 'owner@club.example', appRoles: { stream: 'admin' } },
		]);
		expect(page.get('[data-created]').text()).toContain('emailed to owner@club.example');
	});

	it('asks for a new sign-in when the server says the sign-in is too old', async () => {
		createAnswer = { status: 403, body: { code: 'RECENT_SIGN_IN_REQUIRED', message: 'old' } };
		const page = await opened();

		await page.get('[data-create] input[name="name"]').setValue('New Club');
		await page.get('[data-create] input[name="ownerEmail"]').setValue('owner@club.example');
		await page.get('[data-create] form').trigger('submit');

		await expect.poll(() => page.find('[data-sign-in-again]').exists()).toBe(true);
		await page.get('[data-sign-in-again] button').trigger('click');
		expect(navigate).toHaveBeenCalledWith('/sign-in?returnTo=%2Fplatform');
	});

	it('finds a User by what is typed, and disables them', async () => {
		const page = await opened();

		await page.get('[data-users] input[name="query"]').setValue('ada');
		await page.get('[data-users] form').trigger('submit');
		await expect.poll(() => page.find('[data-user="ada"]').exists()).toBe(true);
		await page.get('[data-user="ada"] [data-disable]').trigger('click');
		await expect
			.poll(() => page.find('[data-user="ada"]').attributes('data-disabled'))
			.toBe('true');

		expect(sentTo('GET', '/api/platform/users').map(({ body }) => body)).toEqual([
			{ q: 'ada' },
			{ q: 'ada' },
		]);
		expect(sentTo('POST', '/api/platform/users/ada/disable')).toHaveLength(1);
	});

	it('makes a found User a Keepr Administrator, and offers it no more once they are', async () => {
		const page = await opened();

		await page.get('[data-users] input[name="query"]').setValue('ada');
		await page.get('[data-users] form').trigger('submit');
		await expect.poll(() => page.find('[data-user="ada"]').exists()).toBe(true);
		await page.get('[data-user="ada"] [data-grant-keepr-administrator]').trigger('click');
		await expect
			.poll(() => page.find('[data-user="ada"] [data-grant-keepr-administrator]').exists())
			.toBe(false);

		expect(sentTo('POST', '/api/platform/users/ada/keepr-administrator')).toHaveLength(1);
	});

	it('shows the Audit Record', async () => {
		const page = await opened();

		const row = page.get('[data-audit-row="row-1"]');
		expect(row.text()).toContain('user.disabled');
		expect(row.text()).toContain('Admin');
		expect(row.text()).toContain('Ada');
	});

	it('is closed to anyone who is not a Keepr Administrator', async () => {
		organisationsAnswer = {
			status: 403,
			body: { code: 'NOT_A_KEEPR_ADMINISTRATOR', message: 'no' },
		};

		const page = await opened();

		expect(page.find('[data-closed]').exists()).toBe(true);
		expect(page.find('[data-create]').exists()).toBe(false);
		expect(sentTo('GET', '/api/platform/audit-record')).toEqual([]);
	});
});
