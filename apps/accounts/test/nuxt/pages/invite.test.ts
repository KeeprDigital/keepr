import { mockNuxtImport, registerEndpoint } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nuxtUiStubs } from '@keepr/nuxt-layer/test/nuxt/helpers/nuxtUiStubs';
import InvitePage from '~/pages/invite.vue';

// The page sends the address, the Organisation role and the App roles chosen to
// the Organisation's invitation route, and says it was emailed: its link goes to
// the invitee alone. The rules are the server's.

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn<(to: string) => void>() }));
mockNuxtImport('navigateTo', () => navigate);

const INVITATIONS = '/api/organisations/keepr/invitations';

const invited: { path: string; body: unknown }[] = [];
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
registerEndpoint('/api/organisations/club/standing', {
	method: 'GET',
	handler: () => ({
		organisation: { id: 'club', name: 'The Club' },
		standing: 'keepr-administrator',
	}),
});
for (const path of [INVITATIONS, '/api/organisations/club/invitations'])
	registerEndpoint(path, {
		method: 'POST',
		handler: async (event) => {
			const { readBody, setResponseStatus } = await import('h3');
			invited.push({ path, body: await readBody(event) });
			setResponseStatus(event, answer.status);
			return answer.body;
		},
	});

const cancelled: string[] = [];
let pending: { id: string }[];

registerEndpoint(INVITATIONS, { method: 'GET', handler: () => pending });
registerEndpoint('/api/organisations/club/invitations', { method: 'GET', handler: () => [] });
registerEndpoint(`${INVITATIONS}/first`, {
	method: 'DELETE',
	handler: () => {
		cancelled.push('first');
		pending = pending.filter(({ id }) => id !== 'first');
		return { cancelled: true };
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
		.poll(
			() =>
				page.find('[data-invited]').exists() ||
				page.find('[data-refusal]').exists() ||
				page.find('[data-sign-in-again]').exists(),
		)
		.toBe(true);
	return page;
}

beforeEach(() => {
	invited.length = 0;
	cancelled.length = 0;
	pending = [];
	answer = { status: 200, body: { invitationId: 'the-invitation' } };
	navigate.mockClear();
	standing = {
		status: 200,
		body: { organisation: { id: 'keepr', name: 'Keepr' }, standing: 'owner' },
	};
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
		expect(cancelled).toEqual(['first']);
	});

	it('show the one just made', async () => {
		const page = await invite(async () => {
			pending = [pendingInvitation('the-invitation', 'newcomer@example.com')];
		});

		await expect.poll(() => rows(page).length).toBe(1);
	});
});

describe('the invite page', () => {
	it('invites with the roles chosen, leaving out an App with no access, and says it was emailed', async () => {
		const page = await invite(async (page) => {
			await page.get('select[data-organisation-role]').setValue('admin');
			await page.get('select[data-app="stream"]').setValue('admin');
		});

		expect(invited).toEqual([
			{
				path: INVITATIONS,
				body: { email: 'newcomer@example.com', role: 'admin', appRoles: { stream: 'admin' } },
			},
		]);
		expect(page.get('[data-invited]').text()).toContain('emailed to newcomer@example.com');
	});

	// Story 48: a Keepr Administrator invites to an Organisation they are not in.
	it('invites to the Organisation the address names, rather than the one worked in', async () => {
		await useRouter().push('/invite?organisation=club');

		const page = await invite(async () => {});

		expect(page.get('[data-organisation]').text()).toContain('The Club');
		expect(invited.map(({ path }) => path)).toEqual(['/api/organisations/club/invitations']);
		await useRouter().push('/invite');
	});

	it('says why an Invitation was refused', async () => {
		answer = { status: 403, body: { code: 'OWNER_REQUIRED', message: 'no' } };

		const page = await invite(async () => {});

		expect(page.get('[data-refusal]').text()).toContain('Only an owner can invite another owner');
		expect(page.find('[data-invited]').exists()).toBe(false);
	});

	it('asks for a new sign-in when the server says the sign-in is too old', async () => {
		answer = { status: 403, body: { code: 'RECENT_SIGN_IN_REQUIRED', message: 'old' } };

		const page = await invite(async () => {});
		await page.get('[data-sign-in-again] button').trigger('click');

		expect(page.find('[data-invited]').exists()).toBe(false);
		expect(navigate).toHaveBeenCalledWith(`/sign-in?returnTo=${encodeURIComponent('/invite')}`);
	});

	it('is closed to a User who does not manage the Organisation', async () => {
		standing = { status: 403, body: { code: 'NOT_A_MANAGER', message: 'no' } };

		const page = mount(InvitePage, { global: { stubs: nuxtUiStubs } });

		await expect.poll(() => page.find('[data-closed]').exists()).toBe(true);
		expect(page.find('form').exists()).toBe(false);
	});
});
