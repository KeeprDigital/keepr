import { describe, expect, it } from 'vitest';
import { createIdentityResolver } from '@keepr/nuxt-layer/server/utils/requestIdentity';
import { createUserNameReader } from '@keepr/nuxt-layer/server/utils/userNames';
import { APP_REGISTRY } from '@keepr/nuxt-layer/shared/utils/appRegistry';
import { USER_NAMES_MAX_IDS, userNamesAddress } from '@keepr/nuxt-layer/shared/utils/userNames';
import {
	type AccountsStandIn,
	createAccountsStandIn,
	LOCAL_DEVELOPER_COOKIE,
	standInCookie,
	type StandInPersona,
} from '../src/standIn';

// The Accounts Stand-in answers a browser its sign-in gave its cookie as the Local
// Developer User with full authority, read by the same identity function an App
// runs in production.

async function resolveThrough(
	standIn: AccountsStandIn,
	app: keyof typeof APP_REGISTRY,
	cookie: string = LOCAL_DEVELOPER_COOKIE,
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
		'answers its own cookie as a Keepr Administrator and owner, with the highest App role in %s',
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
			cookie: LOCAL_DEVELOPER_COOKIE,
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

	// A local browser arrives with no cookie, is refused 401 by the App, and is sent
	// here by its page gate as it would be to Keepr Accounts' sign-in.
	describe('its sign-in', () => {
		const signIn = async (returnTo: string, at = 'http://localhost:8790') =>
			await createAccountsStandIn().fetch(
				new Request(`${at}/sign-in?returnTo=${encodeURIComponent(returnTo)}`),
			);

		it('gives a local browser the Local Developer User and sends it back', async () => {
			const response = await signIn('http://localhost:3000/event/1?tab=screens');

			expect(response.status).toBe(302);
			expect(response.headers.get('location')).toBe('http://localhost:3000/event/1?tab=screens');
			const [cookie] = response.headers.getSetCookie();
			expect(cookie).toMatch(/^keepr-stand-in=;.*Path=\//);
			expect(
				await resolveThrough(createAccountsStandIn(), 'stream', cookie!.split(';')[0]),
			).toMatchObject({ kind: 'signed-in', identity: { user: { id: 'local-developer' } } });
		});

		// A cookie is kept per host, whatever the port: so it is set on the App's.
		it('sends a browser returning to another local host to its sign-in there first', async () => {
			const response = await signIn('http://127.0.0.1:3000/', 'http://localhost:8790');

			expect(response.status).toBe(302);
			expect(response.headers.get('location')).toBe(
				`http://127.0.0.1:8790/sign-in?returnTo=${encodeURIComponent('http://127.0.0.1:3000/')}`,
			);
			expect(response.headers.getSetCookie()).toEqual([]);
		});

		it.each([
			['another site', 'https://elsewhere.example/'],
			['a Keepr host', 'https://stream.keepr.digital/'],
			['a page given as a path', '/event/1'],
			['a local address it does not listen on', 'http://[::1]:3000/'],
		])('refuses to return to %s, 400', async (_case, returnTo) => {
			const response = await signIn(returnTo);

			expect(response.status).toBe(400);
			expect(response.headers.getSetCookie()).toEqual([]);
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

		it.each([
			[
				'someone from another Organisation',
				{ user: 'eve', organisation: { id: 'elsewhere', role: 'member' } },
				{ organisation: { id: 'elsewhere', role: 'member' }, keeprAdministrator: true },
			],
			['someone in no Organisation', { user: 'eve', organisation: null }, { organisation: null }],
			[
				'someone who is no Keepr Administrator',
				{ user: 'eve', keeprAdministrator: false },
				{ organisation: { id: 'keepr-local', role: 'owner' }, keeprAdministrator: false },
			],
		] as const)('answers as %s', async (_case, persona, identity) => {
			expect(await as(persona)).toMatchObject({ kind: 'signed-in', identity });
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

	// What an App shows of a User other than its reader (ADR-0145), read by the
	// layer's own reader. The stand-in holds no Users: it names who it has answered as.
	describe('asked what to call other Users', () => {
		const namesFor = async (standIn: AccountsStandIn, ids: string[], cookie?: string) =>
			await createUserNameReader()({
				cookie,
				accounts: { fetch: async (input, init) => await standIn.fetch(new Request(input, init)) },
				ids,
			});

		it('names the Local Developer User and whoever it has answered as, by the name it gave them', async () => {
			const standIn = createAccountsStandIn();
			await resolveThrough(standIn, 'stream', standInCookie({ user: 'ada', name: 'Ada Lovelace' }));

			const names = await namesFor(
				standIn,
				['ada', 'local-developer', 'never-answered-as'],
				standInCookie({ user: 'grace' }),
			);

			expect(names).toEqual({ ada: 'Ada Lovelace', 'local-developer': 'Local Developer' });
		});

		// Asked directly: the layer's reader would drop a blank name whoever answered it.
		it('leaves a User it gave a blank name unnamed, as Keepr Accounts does', async () => {
			const standIn = createAccountsStandIn();
			await resolveThrough(standIn, 'stream', standInCookie({ user: 'blank', name: ' ' }));

			const response = await standIn.fetch(
				new Request(`https://accounts.keepr.digital${userNamesAddress(['blank'])}`),
			);

			expect(await response.json()).toEqual({ names: {} });
		});

		it.each([
			['a signed-out visitor', ['local-developer'], standInCookie('signed-out'), 401],
			[
				'a longer question than Keepr Accounts takes',
				Array.from({ length: USER_NAMES_MAX_IDS + 1 }, (_, index) => `user-${index}`),
				'',
				400,
			],
		])('refuses %s as Keepr Accounts does', async (_case, ids, cookie, status) => {
			const response = await createAccountsStandIn().fetch(
				new Request(`https://accounts.keepr.digital${userNamesAddress(ids)}`, {
					headers: { cookie },
				}),
			);

			expect(response.status).toBe(status);
		});
	});
});
