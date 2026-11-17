import type { TestAccounts } from '~~/test/helpers/keeprAccounts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestActor } from '~~/server/utils/actor';
import { createTestAccounts, fakeBreachedPasswordService } from '~~/test/helpers/keeprAccounts';

// Who acts in a request to one of Keepr Accounts' own routes: read from its
// Session, and never from a write another origin's page made the browser send.

const USER = 'someone@keepr.digital';
const ADMINISTRATOR = 'administrator@keepr.digital';
const SIGN_IN = new Date('2026-11-17T10:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

let accounts: TestAccounts;

beforeEach(async () => {
	fakeBreachedPasswordService();
	vi.useFakeTimers({ toFake: ['Date'], now: SIGN_IN });
	accounts = await createTestAccounts();
	await accounts.createUser(USER);
	await accounts.createUser(ADMINISTRATOR, { role: 'admin' });
});

afterEach(async () => {
	vi.useRealTimers();
	await accounts.harness.close();
});

function request(headers: Record<string, string>) {
	return new Request('http://localhost:3000/api/organisations/o/members', {
		method: 'POST',
		headers,
	});
}

describe('the Actor of a request', () => {
	it.each([
		['a User', USER, false],
		['a Keepr Administrator', ADMINISTRATOR, true],
	])('is %s, Keepr Administrator: %s', async (_case, email, keeprAdministrator) => {
		const cookie = await accounts.signIn(email);

		const actor = await requestActor(accounts.auth, request({ cookie }));

		expect(actor).toMatchObject({ keeprAdministrator, signedInAt: SIGN_IN });
	});

	it('signed in when they signed in, however often the Session has been renewed since', async () => {
		const cookie = await accounts.signIn(USER);
		vi.setSystemTime(SIGN_IN.getTime() + 2 * DAY_MS);
		await accounts.send('/get-session', { headers: { cookie } });

		const actor = await requestActor(accounts.auth, request({ cookie }));

		expect(actor.signedInAt).toEqual(SIGN_IN);
	});

	it.each([
		['with no Session', 401, 'SIGNED_OUT', async () => ({})],
		[
			'from a page of another Keepr host',
			403,
			'CROSS_SITE_REQUEST',
			async () => ({
				cookie: await accounts.signIn(USER),
				'sec-fetch-site': 'same-site',
				origin: 'https://stream.keepr.digital',
			}),
		],
	])('%s is refused %i %s', async (_case, statusCode, code, headers) => {
		await expect(requestActor(accounts.auth, request(await headers()))).rejects.toMatchObject({
			statusCode,
			code,
		});
	});
});
