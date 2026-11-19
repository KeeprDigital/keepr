import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { nuxtUiStubs } from '@keepr/nuxt-layer/test/nuxt/helpers/nuxtUiStubs';

// A User with no App access to Stream Keepr is refused on every route; this is
// what the page gate shows them in place of a shell of refusals. App access is
// granted, and an Organisation chosen, in Keepr Accounts: the page sends them there.
describe('/no-access', () => {
	it('says the User has no access, and where to go for it', async () => {
		const pagePath = '../../../app/pages/no-access.vue';
		const { default: NoAccessPage } = await import(pagePath);

		const page = mount(NoAccessPage, { global: { stubs: nuxtUiStubs } });

		expect(page.get('[data-testid="no-app-access"]').text()).toContain('no access to Stream Keepr');
		expect(page.findAll('a').map((link) => link.attributes('href'))).toEqual([
			'https://accounts.keepr.digital',
			'/',
		]);
	});
});
