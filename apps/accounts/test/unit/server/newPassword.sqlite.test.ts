import type { TestAccounts } from '~~/test/helpers/keeprAccounts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	createTestAccounts,
	fakeBreachedPasswordService,
	fakeBreachedPasswordServiceDown,
	PASSWORD,
} from '~~/test/helpers/keeprAccounts';

// What a new password must be, on every path a User sets one by.

const EMAIL = 'ada@keepr.digital';
const BREACHED = 'password1234';
const MINIMUM = 'eight-ch';

let accounts: TestAccounts;

beforeEach(async () => {
	accounts = await createTestAccounts();
	fakeBreachedPasswordService();
	await accounts.createUser(EMAIL);
});

afterEach(async () => await accounts.harness.close());

/** Each path that sets a password, setting `newPassword` on Ada's account. */
const paths = {
	async 'a password reset'(newPassword: string) {
		await accounts.send('/request-password-reset', { body: { email: EMAIL } });
		await accounts.afterResponses();
		const token = accounts.email.sent.at(-1)!.text.match(/#token=(\S+)/)![1]!;
		return await accounts.send('/reset-password', { body: { token, newPassword } });
	},
	async 'a change on the profile'(newPassword: string) {
		const cookie = await accounts.signIn(EMAIL);
		return await accounts.send('/change-password', {
			body: { currentPassword: PASSWORD, newPassword },
			headers: { cookie },
		});
	},
};
type Path = keyof typeof paths;
const pathNames = Object.keys(paths) as Path[];

async function signsInWith(password: string) {
	const response = await accounts.send('/sign-in/email', { body: { email: EMAIL, password } });
	return response.status === 200;
}

describe.each(pathNames)('a new password set by %s', (path) => {
	it('is accepted at the minimum length', async () => {
		const response = await paths[path](MINIMUM);

		expect(response.status).toBe(200);
		expect(await signsInWith(MINIMUM)).toBe(true);
	});

	it.each([
		['one character short of the minimum', MINIMUM.slice(1), [], 'PASSWORD_TOO_SHORT'],
		['known from a breach', BREACHED, [BREACHED], 'PASSWORD_COMPROMISED'],
	])('is refused when %s', async (_case, newPassword, breached, code) => {
		fakeBreachedPasswordService(breached);

		const response = await paths[path](newPassword);

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ code });
		expect(await signsInWith(PASSWORD)).toBe(true);
	});

	it('is refused while the breach check cannot be made', async () => {
		fakeBreachedPasswordServiceDown();

		const response = await paths[path]('a-perfectly-fine-password');

		expect(response.status).toBe(500);
		fakeBreachedPasswordService();
		expect(await signsInWith(PASSWORD)).toBe(true);
	});
});
