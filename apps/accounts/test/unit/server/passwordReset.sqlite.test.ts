import type { TestAccounts } from '~~/test/helpers/keeprAccounts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '@keepr/nuxt-layer/test/helpers/deferred';
import {
	createTestAccounts,
	fakeBreachedPasswordService,
	PASSWORD,
} from '~~/test/helpers/keeprAccounts';

// A User resets their own password from an emailed link, request in and response out.

const EMAIL = 'ada@keepr.digital';
const NEW_PASSWORD = 'a-brand-new-password';
const MINUTE_MS = 60 * 1000;

let accounts: TestAccounts;

beforeEach(async () => {
	fakeBreachedPasswordService();
	accounts = await createTestAccounts();
	await accounts.createUser(EMAIL);
});

afterEach(async () => {
	vi.useRealTimers();
	await accounts.harness.close();
});

function requestReset(email = EMAIL) {
	return accounts.send('/request-password-reset', { body: { email } });
}

/** The token in the one reset link emailed to `email`. */
async function emailedToken(email = EMAIL) {
	await accounts.afterResponses();
	const emails = accounts.email.sent.filter((sent) => sent.to === email);
	expect(emails).toHaveLength(1);
	const link = emails[0]!.text.match(/http:\/\/localhost:3000\/reset-password#token=(\S+)/);
	expect(link, 'a link to the reset page, the token in its fragment').not.toBeNull();
	expect(emails[0]!.html).toContain(link![0]);
	return link![1]!;
}

function resetPassword(token: string, newPassword = NEW_PASSWORD) {
	return accounts.send('/reset-password', { body: { token, newPassword } });
}

function signInWith(password: string) {
	return accounts.send('/sign-in/email', { body: { email: EMAIL, password } });
}

describe('a password reset', () => {
	it('emails a link that sets a new password', async () => {
		expect((await requestReset()).status).toBe(200);

		const reset = await resetPassword(await emailedToken());

		expect(reset.status).toBe(200);
		expect((await signInWith(NEW_PASSWORD)).status).toBe(200);
		expect((await signInWith(PASSWORD)).status).toBe(401);
	});

	it('works once', async () => {
		await requestReset();
		const token = await emailedToken();
		await resetPassword(token);

		const again = await resetPassword(token, 'yet-another-password');

		expect(again.status).toBe(400);
		expect(await again.json()).toMatchObject({ code: 'INVALID_TOKEN' });
		expect((await signInWith(NEW_PASSWORD)).status).toBe(200);
	});

	it.each([
		['works just inside an hour', 59 * MINUTE_MS, 200],
		['has expired after an hour', 61 * MINUTE_MS, 400],
	])('%s', async (_case, later, status) => {
		vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-17T10:00:00Z') });
		await requestReset();
		const token = await emailedToken();

		vi.setSystemTime(Date.now() + later);

		expect((await resetPassword(token)).status).toBe(status);
	});

	it("ends every Session the User's old password opened", async () => {
		const cookie = await accounts.signIn(EMAIL);
		await requestReset();

		await resetPassword(await emailedToken());

		const session = await accounts.send('/get-session', { headers: { cookie } });
		expect(await session.json()).toBeNull();
	});
});

describe('a reset request', () => {
	it('for an address with no User answers as one for a real account, and sends nothing', async () => {
		const real = await requestReset();
		const nobody = await requestReset('nobody@keepr.digital');
		await accounts.afterResponses();

		expect(nobody.status).toBe(real.status);
		expect(await nobody.json()).toEqual(await real.json());
		expect(accounts.email.sent.map((sent) => sent.to)).toEqual([EMAIL]);
	});

	it('answers before its email is sent', async () => {
		const sending = deferred();
		let started = 0;
		await accounts.harness.close();
		accounts = await createTestAccounts({
			email: {
				send: async () => {
					started++;
					await sending.promise;
				},
			},
		});
		await accounts.createUser(EMAIL);

		const answer = await Promise.race([
			requestReset(),
			new Promise<'still waiting'>((resolve) => setTimeout(resolve, 2000, 'still waiting')),
		]);

		expect(answer).toBeInstanceOf(Response);
		expect(started).toBe(1);
		sending.resolve();
		await accounts.afterResponses();
	});
});
