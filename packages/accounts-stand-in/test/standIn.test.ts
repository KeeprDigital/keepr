import { describe, expect, it } from 'vitest';
import { createIdentityResolver } from '@keepr/nuxt-layer/server/utils/requestIdentity';
import { APP_REGISTRY } from '@keepr/nuxt-layer/shared/utils/appRegistry';
import { type AccountsStandIn, createAccountsStandIn } from '../src/standIn';

// The Accounts Stand-in answers every request as the Local Developer User with full
// authority, read by the same identity function an App runs in production.

async function resolveThrough(standIn: AccountsStandIn, app: keyof typeof APP_REGISTRY) {
	return await createIdentityResolver(app)({
		accounts: { fetch: async (input, init) => await standIn.fetch(new Request(input, init)) },
	});
}

describe('the Accounts Stand-in', () => {
	it.each([
		['stream', 'admin'],
		['score', 'admin'],
	] as const)(
		'answers with no sign-in as a Keepr Administrator and owner, with the highest App role in %s',
		async (app, appRole) => {
			const answer = await resolveThrough(createAccountsStandIn(), app);

			expect(answer).toMatchObject({
				kind: 'signed-in',
				identity: {
					user: { name: 'Local Developer' },
					organisation: { role: 'owner' },
					appRole,
					keeprAdministrator: true,
				},
			});
		},
	);

	it('works in the same Organisation every run', async () => {
		const [first, second] = await Promise.all([
			resolveThrough(createAccountsStandIn(), 'stream'),
			resolveThrough(createAccountsStandIn(), 'stream'),
		]);

		expect(first).toMatchObject({ identity: { organisation: { id: 'keepr-local' } } });
		expect(second).toMatchObject({ identity: { organisation: { id: 'keepr-local' } } });
	});

	it('signs with its own key, which only it publishes', async () => {
		const standIn = createAccountsStandIn();
		const other = createAccountsStandIn();
		const { token } = (await (
			await standIn.fetch(new Request('https://accounts.keepr.digital/api/auth/token'))
		).json()) as {
			token: string;
		};

		const answer = await createIdentityResolver('stream')({
			accounts: {
				fetch: async (input) =>
					new URL(input).pathname === '/api/auth/token'
						? Response.json({ token })
						: await other.fetch(new Request(input)),
			},
		});

		expect(answer).toMatchObject({
			kind: 'unavailable',
			reason: expect.stringContaining('ERR_JWKS_NO_MATCHING_KEY'),
		});
	});

	it('serves nothing else, naming itself', async () => {
		const response = await createAccountsStandIn().fetch(
			new Request('https://accounts.keepr.digital/api/auth/sign-in/email', { method: 'POST' }),
		);

		expect(response.status).toBe(404);
		expect(await response.text()).toContain('Accounts Stand-in');
	});
});
