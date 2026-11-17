import { mockNuxtImport, registerEndpoint } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nuxtUiStubs } from '@keepr/nuxt-layer/test/nuxt/helpers/nuxtUiStubs';
import MembersPage from '~/pages/members.vue';

// The page lists the members the server answers and sends each change to its
// route; the rules, the recent sign-in among them, are the server's.

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn<(to: string) => void>() }));
mockNuxtImport('navigateTo', () => navigate);

const MEMBERS = '/api/organisations/keepr/members';
const ADA = 'member-ada';

let standing: { status: number; body: unknown };
let answer: { status: number; body: unknown };
const sent: { method: string; path: string; body: unknown }[] = [];

/** A change route at `path`, which records what it was sent and answers `answer`. */
function changeRoute(method: 'PUT' | 'DELETE', path: string) {
	registerEndpoint(path, {
		method,
		handler: async (event) => {
			const { readBody, setResponseStatus } = await import('h3');
			sent.push({ method, path, body: method === 'PUT' ? await readBody(event) : undefined });
			setResponseStatus(event, answer.status);
			return answer.body;
		},
	});
}

registerEndpoint('/api/auth/get-session', {
	method: 'GET',
	handler: () => ({ user: { name: 'Owner' }, session: { activeOrganizationId: 'keepr' } }),
});
registerEndpoint('/api/organisations/keepr/standing', {
	method: 'GET',
	handler: async (event) => {
		const { setResponseStatus } = await import('h3');
		setResponseStatus(event, standing.status);
		return standing.body;
	},
});
registerEndpoint(MEMBERS, {
	method: 'GET',
	handler: () => ({
		organisation: { id: 'keepr', name: 'Keepr' },
		standing: 'owner',
		members: [
			{
				memberId: ADA,
				userId: 'ada',
				name: 'Ada',
				email: 'ada@keepr.digital',
				role: 'member',
				apps: { stream: 'admin' },
			},
		],
	}),
});
changeRoute('PUT', `${MEMBERS}/${ADA}/role`);
changeRoute('DELETE', `${MEMBERS}/${ADA}/app-access/stream`);
changeRoute('PUT', `${MEMBERS}/${ADA}/app-access/score`);
changeRoute('DELETE', `${MEMBERS}/${ADA}`);

async function opened() {
	const page = mount(MembersPage, { global: { stubs: nuxtUiStubs } });
	await flushPromises();
	await expect
		.poll(() => page.find('[data-member]').exists() || page.find('[data-closed]').exists())
		.toBe(true);
	return page;
}

async function settled(page: ReturnType<typeof mount>) {
	await expect.poll(() => sent.length).toBeGreaterThan(0);
	await flushPromises();
	return page;
}

beforeEach(() => {
	sent.length = 0;
	navigate.mockClear();
	standing = {
		status: 200,
		body: { organisation: { id: 'keepr', name: 'Keepr' }, standing: 'owner' },
	};
	answer = { status: 200, body: {} };
});

describe('the members page', () => {
	it('lists each member with their Organisation role and App roles', async () => {
		const page = await opened();

		const member = page.get(`[data-member-id="${ADA}"]`);
		expect(member.text()).toContain('ada@keepr.digital');
		expect((member.get('select[data-organisation-role]').element as HTMLSelectElement).value).toBe(
			'member',
		);
		expect((member.get('select[data-app="stream"]').element as HTMLSelectElement).value).toBe(
			'admin',
		);
		expect((member.get('select[data-app="score"]').element as HTMLSelectElement).value).toBe(
			'none',
		);
	});

	it.each([
		[
			'an Organisation role',
			async (page: ReturnType<typeof mount>) =>
				await page.get('select[data-organisation-role]').setValue('admin'),
			{ method: 'PUT', path: `${MEMBERS}/${ADA}/role`, body: { role: 'admin' } },
		],
		[
			'an App role',
			async (page: ReturnType<typeof mount>) =>
				await page.get('select[data-app="score"]').setValue('member'),
			{ method: 'PUT', path: `${MEMBERS}/${ADA}/app-access/score`, body: { role: 'member' } },
		],
		[
			'no access to an App',
			async (page: ReturnType<typeof mount>) =>
				await page.get('select[data-app="stream"]').setValue('none'),
			{ method: 'DELETE', path: `${MEMBERS}/${ADA}/app-access/stream`, body: undefined },
		],
		[
			'a removal, once confirmed',
			async (page: ReturnType<typeof mount>) => {
				await page.get('[data-remove]').trigger('click');
				await page.get('[data-confirm-removal]').trigger('click');
			},
			{ method: 'DELETE', path: `${MEMBERS}/${ADA}`, body: undefined },
		],
	])('sends %s to its route', async (_case, choose, request) => {
		const page = await opened();

		await choose(page);
		await settled(page);

		expect(sent).toEqual([request]);
	});

	it('asks for a new sign-in when the server says the sign-in is too old', async () => {
		answer = { status: 403, body: { code: 'RECENT_SIGN_IN_REQUIRED', message: 'old' } };
		const page = await opened();

		await page.get('select[data-organisation-role]').setValue('admin');
		await settled(page);

		await expect.poll(() => page.find('[data-sign-in-again]').exists()).toBe(true);
		await page.get('[data-sign-in-again] button').trigger('click');
		expect(navigate).toHaveBeenCalledWith('/sign-in?returnTo=%2Fmembers');
	});

	it('says why a change was refused', async () => {
		answer = { status: 409, body: { code: 'LAST_OWNER', message: 'last' } };
		const page = await opened();

		await page.get('select[data-organisation-role]').setValue('admin');
		await settled(page);

		await expect.poll(() => page.find('[data-refusal]').exists()).toBe(true);
		expect(page.get('[data-refusal]').text()).toContain('at least one owner');
	});

	it('is closed to a User who does not manage the Organisation', async () => {
		standing = { status: 403, body: { code: 'NOT_A_MANAGER', message: 'no' } };

		const page = await opened();

		expect(page.find('[data-closed]').exists()).toBe(true);
		expect(page.find('[data-member]').exists()).toBe(false);
	});
});
