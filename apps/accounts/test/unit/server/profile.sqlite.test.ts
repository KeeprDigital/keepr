import type { TestAccounts } from '~~/test/helpers/keeprAccounts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	cookiesOf,
	createTestAccounts,
	fakeBreachedPasswordService,
	PASSWORD,
} from '~~/test/helpers/keeprAccounts';

// What a User does to their own account on the profile, request in and response out.

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

interface ListedSession {
	token: string;
	userAgent: string;
}

async function sessionsOf(cookie: string) {
	const response = await accounts.send('/list-sessions', { headers: { cookie } });
	expect(response.status).toBe(200);
	return (await response.json()) as ListedSession[];
}

async function signedInAs(cookie: string) {
	const response = await accounts.send('/get-session', { headers: { cookie } });
	return (await response.json()) as { user: { name: string }; session: { token: string } } | null;
}

async function signInOn(userAgent: string) {
	const response = await accounts.send('/sign-in/email', {
		body: { email: EMAIL, password: PASSWORD },
		headers: { 'user-agent': userAgent },
	});
	return cookiesOf(response);
}

describe('the name', () => {
	it('is the User’s to change, and kept trimmed', async () => {
		const cookie = await accounts.signIn(EMAIL);

		const response = await accounts.send('/update-user', {
			body: { name: '  Ada Lovelace ' },
			headers: { cookie },
		});

		expect(response.status).toBe(200);
		expect((await signedInAs(cookie))!.user.name).toBe('Ada Lovelace');
	});

	it('cannot be made blank: the User keeps the one they had', async () => {
		const cookie = await accounts.signIn(EMAIL);

		const response = await accounts.send('/update-user', {
			body: { name: '   ' },
			headers: { cookie },
		});

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ code: 'NAME_REQUIRED' });
		expect((await signedInAs(cookie))!.user.name).toBe('ada');
	});
});

describe('the active Sessions', () => {
	it('are listed for a User who signed in days ago', async () => {
		vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-17T10:00:00Z') });
		const [laptop] = await Promise.all(['Laptop', 'Phone'].map(signInOn));

		vi.setSystemTime(Date.now() + 3 * DAY_MS);

		expect((await sessionsOf(laptop!)).map((session) => session.userAgent).toSorted()).toEqual([
			'Laptop',
			'Phone',
		]);
	});

	it('can each be ended by their User, leaving the rest', async () => {
		const laptop = await accounts.signIn(EMAIL);
		const phone = await accounts.signIn(EMAIL);
		const phoneToken = (await signedInAs(phone))!.session.token;
		expect((await sessionsOf(laptop)).map((session) => session.token)).toContain(phoneToken);

		const response = await accounts.send('/revoke-session', {
			body: { token: phoneToken },
			headers: { cookie: laptop },
		});

		expect(response.status).toBe(200);
		expect(await signedInAs(phone)).toBeNull();
		expect(await signedInAs(laptop)).not.toBeNull();
	});

	it('of another User cannot be ended', async () => {
		await accounts.createUser('grace@keepr.digital');
		const grace = await accounts.signIn('grace@keepr.digital');
		const graceToken = (await signedInAs(grace))!.session.token;
		const ada = await accounts.signIn(EMAIL);

		await accounts.send('/revoke-session', {
			body: { token: graceToken },
			headers: { cookie: ada },
		});

		expect(await signedInAs(grace)).not.toBeNull();
	});
});
