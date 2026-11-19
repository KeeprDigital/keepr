import { describe, expect, it } from 'vitest';
import { createIdentityResolver } from '@keepr/nuxt-layer/server/utils/requestIdentity';
import { APP_REGISTRY } from '@keepr/nuxt-layer/shared/utils/appRegistry';
import {
	type AccountsStandIn,
	createAccountsStandIn,
	standInCookie,
	type StandInPersona,
} from '../src/standIn';

// The Accounts Stand-in answers every request as the Local Developer User with full
// authority, read by the same identity function an App runs in production.

async function resolveThrough(
	standIn: AccountsStandIn,
	app: keyof typeof APP_REGISTRY,
	cookie?: string,
) {
	return await createIdentityResolver(app)({
		cookie,
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

	// A whole server's tests need someone other than the Local Developer User: the
	// cookie an App forwards names them, as a session cookie names a User to Keepr Accounts.
	describe('asked by its cookie to answer as someone else', () => {
		const as = async (persona: StandInPersona | 'signed-out', cookies = '') =>
			await resolveThrough(
				createAccountsStandIn(),
				'stream',
				[cookies, standInCookie(persona)].filter(Boolean).join('; '),
			);

		it('answers a signed-out visitor as Keepr Accounts does, with no Identity Proof', async () => {
			expect(await as('signed-out', 'theme=dark')).toMatchObject({ kind: 'signed-out' });
		});

		it.each([
			['no App access to the App named', { stream: null }, null],
			['the App role named', { stream: 'member' }, 'member'],
			['the highest App role where another App is named', { score: null }, 'admin'],
		] as const)('answers with %s', async (_case, apps, appRole) => {
			expect(await as({ user: 'ada', apps })).toMatchObject({
				kind: 'signed-in',
				identity: { user: { id: 'ada', name: 'ada', email: 'ada@keepr.invalid' }, appRole },
			});
		});

		it('answers a second Session of one User, and a User by the name given', async () => {
			const [first, second] = await Promise.all([
				as({ user: 'ada', name: 'Ada Lovelace' }),
				as({ user: 'ada', session: 'second-browser' }),
			]);

			expect(first).toMatchObject({
				identity: { user: { id: 'ada', name: 'Ada Lovelace' }, sessionId: 'ada-session' },
			});
			expect(second).toMatchObject({
				identity: { user: { id: 'ada' }, sessionId: 'second-browser' },
			});
		});
	});
});
