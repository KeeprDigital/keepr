import type { TestAccounts } from '~~/test/helpers/keeprAccounts';
import { createLocalJWKSet, decodeJwt, jwtVerify } from 'jose';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestAccounts, fakeBreachedPasswordService } from '~~/test/helpers/keeprAccounts';

// Keepr Accounts mints an Identity Proof from the browser's cookie and publishes the
// keys it verifies against: request in, response out.

let accounts: TestAccounts;

beforeEach(async () => {
	fakeBreachedPasswordService();
	accounts = await createTestAccounts();
});

afterEach(async () => await accounts.harness.close());

async function identityProof(cookie: string) {
	const response = await accounts.send('/token', { headers: { cookie } });
	return {
		response,
		token: response.ok ? ((await response.json()) as { token: string }).token : '',
	};
}

async function verified(token: string) {
	const keys = (await (await accounts.send('/jwks')).json()) as { keys: never[] };
	return (
		await jwtVerify(token, createLocalJWKSet(keys as never), {
			issuer: 'https://accounts.keepr.digital',
			audience: 'https://keepr.digital',
			algorithms: ['EdDSA'],
		})
	).payload;
}

describe('an Identity Proof', () => {
	it('names the User, Session, active Organisation, roles and Keepr Administrator flag', async () => {
		const { id } = await accounts.createUser('ada@keepr.digital', { role: 'admin' });
		const { organizationId } = await accounts.addMember(id, 'keepr', {
			role: 'owner',
			apps: { stream: 'admin', score: 'member' },
		});
		const cookie = await accounts.signIn('ada@keepr.digital');
		const session = (await (
			await accounts.send('/get-session', { headers: { cookie } })
		).json()) as {
			session: { id: string };
		};

		const payload = await verified((await identityProof(cookie)).token);

		expect(payload).toMatchObject({
			sub: id,
			sid: session.session.id,
			email: 'ada@keepr.digital',
			name: 'ada',
			org: organizationId,
			orgRole: 'owner',
			apps: { stream: 'admin', score: 'member' },
			keeprAdmin: true,
		});
	});

	it('is good for five minutes', async () => {
		await accounts.createUser('ada@keepr.digital');
		const { token } = await identityProof(await accounts.signIn('ada@keepr.digital'));

		const { iat, exp } = decodeJwt(token);

		expect(exp! - iat!).toBe(300);
	});

	it.each([
		['the Organisation they joined first', ['first', 'second'], 'first', 'admin'],
		['no Organisation when they belong to none', [], null, null],
	])('works in %s straight after signing in', async (_case, slugs, activeSlug, orgRole) => {
		const { id } = await accounts.createUser('ada@keepr.digital');
		const organisations: Record<string, string> = {};
		for (const [index, slug] of slugs.entries())
			organisations[slug] = (
				await accounts.addMember(id, slug, { role: index === 0 ? 'admin' : 'member' })
			).organizationId;

		const { token } = await identityProof(await accounts.signIn('ada@keepr.digital'));

		expect(decodeJwt(token)).toMatchObject({
			org: activeSlug === null ? null : organisations[activeSlug],
			orgRole,
			apps: {},
			keeprAdmin: false,
		});
	});

	it('names only the App access held in the active Organisation', async () => {
		const { id } = await accounts.createUser('ada@keepr.digital');
		await accounts.addMember(id, 'first', { apps: { stream: 'member' } });
		await accounts.addMember(id, 'second', { apps: { score: 'admin' } });

		const { token } = await identityProof(await accounts.signIn('ada@keepr.digital'));

		expect(decodeJwt(token).apps).toEqual({ stream: 'member' });
	});
});

describe('no Identity Proof is minted', () => {
	it.each([
		['with no cookie', async (_userId: string) => ''],
		[
			'for an ended Session',
			async () => {
				const cookie = await accounts.signIn('ada@keepr.digital');
				await accounts.send('/sign-out', { body: {}, headers: { cookie } });
				return cookie;
			},
		],
		[
			'for a disabled User whose Session was left open',
			async (userId: string) => {
				const cookie = await accounts.signIn('ada@keepr.digital');
				// Disabling is a Keepr Administrator's route, not built yet: the same write, made directly.
				await (await accounts.auth.$context).internalAdapter.updateUser(userId, { banned: true });
				return cookie;
			},
		],
	])('%s', async (_case, cookieFor) => {
		const { id } = await accounts.createUser('ada@keepr.digital');

		const { response } = await identityProof(await cookieFor(id));

		expect(response.status).toBe(401);
	});
});
