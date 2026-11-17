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

registerEndpoint('/api/auth/get-session', {
	method: 'GET',
	handler: () => ({ user: { name: 'Ada' }, session: { token: 'token' } }),
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

const cancelled: unknown[] = [];
let pending: unknown[];

registerEndpoint('/api/invitation/pending', { method: 'GET', handler: () => pending });
registerEndpoint('/api/auth/organization/cancel-invitation', {
	method: 'POST',
	handler: async (event) => {
		const { readBody } = await import('h3');
		const body = (await readBody(event)) as { invitationId: string };
		cancelled.push(body);
		pending = pending.filter(
			(invitation) => (invitation as { id: string }).id !== body.invitationId,
		);
		return { status: 'canceled' };
	},
});

async function invite(choose: (page: ReturnType<typeof mount>) => Promise<void>) {
	const page = mount(InvitePage, { global: { stubs: nuxtUiStubs } });
	await flushPromises();
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
	cancelled.length = 0;
	pending = [];
	answer = { status: 200, body: { id: 'the-invitation' } };
});

function pendingInvitation(id: string, email: string) {
	return {
		id,
		email,
		role: 'member',
		appRoles: { stream: 'admin' },
		inviterName: 'Ada',
		expiresAt: '2026-11-24T10:00:00.000Z',
	};
}

describe('the pending Invitations', () => {
	const rows = (page: ReturnType<typeof mount>) => page.findAll('[data-pending-invitation]');

	it('are listed, and one is cancelled', async () => {
		pending = [
			pendingInvitation('first', 'first@example.com'),
			pendingInvitation('second', 'second@example.com'),
		];
		const page = mount(InvitePage, { global: { stubs: nuxtUiStubs } });
		await expect.poll(() => rows(page).length).toBe(2);
		expect(rows(page)[0]!.text()).toContain('first@example.com');
		expect(rows(page)[0]!.text()).toContain('Stream Keepr: admin');

		await rows(page)[0]!.get('[data-cancel]').trigger('click');

		await expect
			.poll(() => rows(page).map((row) => row.attributes('data-pending-invitation')))
			.toEqual(['second']);
		expect(cancelled).toEqual([{ invitationId: 'first' }]);
	});

	it('show the one just made', async () => {
		const page = await invite(async () => {
			pending = [pendingInvitation('the-invitation', 'newcomer@example.com')];
		});

		await expect.poll(() => rows(page).length).toBe(1);
	});
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
});
