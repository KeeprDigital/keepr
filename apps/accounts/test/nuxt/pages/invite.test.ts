import { mockNuxtImport, registerEndpoint } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nuxtUiStubs } from '@keepr/nuxt-layer/test/nuxt/helpers/nuxtUiStubs';
import InvitePage from '~/pages/invite.vue';

// The page sends the address, the Organisation role and the App roles chosen to the
// library's invite route, and shows the Invitation's link to copy; the rules are
// the server's.

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn<(to: string) => void>() }));
mockNuxtImport('navigateTo', () => navigate);

const invited: unknown[] = [];
let answer: { status: number; body: unknown };

let standing: { status: number; body: unknown };

registerEndpoint('/api/auth/get-session', {
	method: 'GET',
	handler: () => ({
		user: { name: 'Ada' },
		session: { token: 'token', activeOrganizationId: 'keepr' },
	}),
});
registerEndpoint('/api/organisations/keepr/standing', {
	method: 'GET',
	handler: async (event) => {
		const { setResponseStatus } = await import('h3');
		setResponseStatus(event, standing.status);
		return standing.body;
	},
});
registerEndpoint('/api/auth/organization/invite-member', {
	method: 'POST',
	handler: async (event) => {
		const { readBody, setResponseStatus } = await import('h3');
		invited.push(await readBody(event));
		setResponseStatus(event, answer.status);
		return answer.body;
	},
});

async function invite(choose: (page: ReturnType<typeof mount>) => Promise<void>) {
	const page = mount(InvitePage, { global: { stubs: nuxtUiStubs } });
	await flushPromises();
	await expect.poll(() => page.find('input[type="email"]').exists()).toBe(true);
	await page.find('input[type="email"]').setValue('newcomer@example.com');
	await choose(page);
	await page.find('form').trigger('submit');
	await expect
		.poll(() => page.find('[data-invited]').exists() || page.find('[data-refusal]').exists())
		.toBe(true);
	return page;
}

beforeEach(() => {
	invited.length = 0;
	answer = { status: 200, body: { id: 'the-invitation' } };
	standing = {
		status: 200,
		body: { organisation: { id: 'keepr', name: 'Keepr' }, standing: 'owner' },
	};
});

describe('the invite page', () => {
	it('invites with the roles chosen, leaving out an App with no access, and shows the link', async () => {
		const page = await invite(async (page) => {
			await page.get('select[data-organisation-role]').setValue('admin');
			await page.get('select[data-app="stream"]').setValue('admin');
		});

		expect(invited).toEqual([
			{
				email: 'newcomer@example.com',
				role: 'admin',
				appRoles: JSON.stringify({ stream: 'admin' }),
			},
		]);
		expect((page.get('[data-link]').element as HTMLInputElement).value).toBe(
			`${window.location.origin}/invitation#id=the-invitation`,
		);
	});

	it('says why an Invitation was refused', async () => {
		answer = {
			status: 403,
			body: { code: 'YOU_ARE_NOT_ALLOWED_TO_INVITE_USER_WITH_THIS_ROLE', message: 'no' },
		};

		const page = await invite(async () => {});

		expect(page.get('[data-refusal]').text()).toContain('Only an owner can invite another owner');
		expect(page.find('[data-invited]').exists()).toBe(false);
	});

	it('is closed to a User who does not manage the Organisation', async () => {
		standing = { status: 403, body: { code: 'NOT_A_MANAGER', message: 'no' } };

		const page = mount(InvitePage, { global: { stubs: nuxtUiStubs } });

		await expect.poll(() => page.find('[data-closed]').exists()).toBe(true);
		expect(page.find('form').exists()).toBe(false);
	});
});
