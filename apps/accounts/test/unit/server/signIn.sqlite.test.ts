import type { TestAccounts } from '~~/test/helpers/keeprAccounts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DISABLED_USER_MESSAGE } from '~~/server/utils/authOptions';
import {
	cookiesOf,
	createTestAccounts,
	fakeBreachedPasswordService,
	PASSWORD,
	sessionSetCookie,
} from '~~/test/helpers/keeprAccounts';

// Signing in and out of Keepr Accounts, request in and response out, on the real migrations.

const EMAIL = 'ada@keepr.digital';
const DAY_MS = 24 * 60 * 60 * 1000;

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

async function sessionOf(cookie: string) {
	const response = await accounts.send('/get-session', { headers: { cookie } });
	return (await response.json()) as { session: { expiresAt: string } } | null;
}

describe('signing in', () => {
	it('answers a Session for the right password', async () => {
		const response = await accounts.send('/sign-in/email', {
			body: { email: EMAIL, password: PASSWORD },
		});

		expect(response.status).toBe(200);
		expect(await sessionOf(cookiesOf(response))).not.toBeNull();
	});

	it.each([
		['a wrong password', EMAIL, 'not-the-password', 401, 'INVALID_EMAIL_OR_PASSWORD'],
		['an address with no User', 'nobody@keepr.digital', PASSWORD, 401, 'INVALID_EMAIL_OR_PASSWORD'],
	])('refuses %s', async (_case, email, password, status, code) => {
		const response = await accounts.send('/sign-in/email', { body: { email, password } });

		expect(response.status).toBe(status);
		expect(await response.json()).toMatchObject({ code });
		expect(sessionSetCookie(response)).toBeUndefined();
	});

	it('tells a disabled User so, plainly', async () => {
		const { id } = await accounts.createUser('disabled@keepr.digital');
		// Disabling is a Keepr Administrator's route, not built yet: the same write, made directly.
		await (await accounts.auth.$context).internalAdapter.updateUser(id, { banned: true });

		const response = await accounts.send('/sign-in/email', {
			body: { email: 'disabled@keepr.digital', password: PASSWORD },
		});

		expect(response.status).toBe(403);
		expect(await response.json()).toMatchObject({
			code: 'BANNED_USER',
			message: DISABLED_USER_MESSAGE,
		});
	});
});

describe('signing out', () => {
	it('ends the Session at once, for every request that still carries its cookie', async () => {
		const cookie = await accounts.signIn(EMAIL);

		const response = await accounts.send('/sign-out', { body: {}, headers: { cookie } });

		expect(response.status).toBe(200);
		expect(await sessionOf(cookie)).toBeNull();
	});
});

describe('a Session', () => {
	it('lasts seven days from sign-in', async () => {
		vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-17T10:00:00Z') });
		const response = await accounts.send('/sign-in/email', {
			body: { email: EMAIL, password: PASSWORD },
		});

		expect(sessionSetCookie(response)!.attributes).toContain(`max-age=${7 * 24 * 60 * 60}`);
		expect((await sessionOf(cookiesOf(response)))!.session.expiresAt).toBe(
			'2026-11-24T10:00:00.000Z',
		);
	});

	it.each([
		['is not renewed within a day of its last renewal', 0.5 * DAY_MS, '2026-11-24T10:00:00.000Z'],
		['renews for seven more days when used after a day', 2 * DAY_MS, '2026-11-26T10:00:00.000Z'],
	])('%s', async (_case, later, expiresAt) => {
		vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-17T10:00:00Z') });
		const cookie = await accounts.signIn(EMAIL);

		vi.setSystemTime(Date.now() + later);

		expect((await sessionOf(cookie))!.session.expiresAt).toBe(expiresAt);
	});

	it('has lapsed after seven days unused', async () => {
		vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-17T10:00:00Z') });
		const cookie = await accounts.signIn(EMAIL);

		vi.setSystemTime(Date.now() + 7 * DAY_MS + 1000);

		expect(await sessionOf(cookie)).toBeNull();
	});
});
