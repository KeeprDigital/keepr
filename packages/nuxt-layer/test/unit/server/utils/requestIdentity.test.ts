import type { AccountsConnection } from '../../../../server/utils/requestIdentity';
import type { Identity } from '../../../../shared/utils/identityProof';
import { createApp, eventHandler, toWebHandler } from 'h3';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import {
	createIdentityResolver,
	requireAppAccess,
	requireAppRole,
	resolveRequestIdentity,
} from '../../../../server/utils/requestIdentity';

// How an App's route meets the identity function: the binding it reads, the cookie
// it forwards, what it passes back, and how it refuses. The function's rules are
// tested against a real Keepr Accounts in `apps/accounts`, which the layer cannot import.

const { privateKey, publicKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
const publicKeys = { keys: [{ ...(await exportJWK(publicKey)), kid: 'k', alg: 'EdDSA' }] };

/** Keepr Accounts as the binding answers: a proof for `session=ada`, 401 for anything else. */
const keeprAccounts: AccountsConnection = {
	async fetch(input, init) {
		const request = new Request(input, init);
		if (request.url.endsWith('/api/auth/jwks')) return Response.json(publicKeys);
		if (request.headers.get('cookie') !== 'session=ada') return new Response(null, { status: 401 });
		const token = await new SignJWT({
			sid: 's',
			email: 'ada@keepr.digital',
			name: 'Ada',
			org: null,
			orgRole: null,
			apps: { stream: 'member' },
			keeprAdmin: false,
		})
			.setProtectedHeader({ alg: 'EdDSA', kid: 'k' })
			.setSubject('ada')
			.setIssuer('https://accounts.keepr.digital')
			.setAudience('https://keepr.digital')
			.setIssuedAt()
			.setExpirationTime('5m')
			.sign(privateKey);
		return Response.json({ token }, { headers: { 'set-cookie': 'session=ada; Max-Age=604800' } });
	},
};

/** Nothing registered under the service's name, as the local dev registry answers. */
const nothingRegistered: AccountsConnection = {
	fetch: async () =>
		new Response('Worker "keepr-accounts" not found. Make sure it is running locally.', {
			status: 503,
		}),
};

/** An App's route that answers who the request belongs to, or the refusal it was given. */
async function whoAmI(cookie: string, env: Record<string, unknown>) {
	const app = createApp();
	app.use(
		eventHandler(async (event) => {
			event.context.cloudflare = { env };
			try {
				return await resolveRequestIdentity(event, 'stream', createIdentityResolver('stream'));
			} catch (error) {
				const { statusCode, message, data } = error as {
					statusCode: number;
					message: string;
					data?: { code?: string };
				};
				return { refused: statusCode, message, code: data?.code };
			}
		}),
	);
	const response = await toWebHandler(app)(
		new Request('https://stream.keepr.digital/api/identity', { headers: { cookie } }),
	);
	return { body: await response.json(), setCookie: response.headers.getSetCookie() };
}

describe('resolveRequestIdentity', () => {
	it('forwards the cookie over the KEEPR_ACCOUNTS binding and passes the renewed one back', async () => {
		const { body, setCookie } = await whoAmI('session=ada', { KEEPR_ACCOUNTS: keeprAccounts });

		expect(body).toMatchObject({ user: { id: 'ada' }, appRole: 'member' });
		expect(setCookie).toEqual(['session=ada; Max-Age=604800']);
	});

	it.each([
		[
			'a signed-out visitor',
			'session=nobody',
			{ KEEPR_ACCOUNTS: keeprAccounts },
			401,
			'SIGNED_OUT',
		],
		['an App with no binding, naming it', 'session=ada', {}, 503, 'KEEPR_ACCOUNTS is not bound'],
	])('refuses %s', async (_case, cookie, env, refused, says) => {
		const { body } = await whoAmI(cookie, env);

		expect(body.refused).toBe(refused);
		expect(JSON.stringify(body)).toContain(says);
	});

	it('names the missing service and how to start the Accounts Stand-in, not a bare 503', async () => {
		const { body } = await whoAmI('session=ada', { KEEPR_ACCOUNTS: nothingRegistered });

		expect(body.refused).toBe(503);
		expect(body.message).toContain('"keepr-accounts"');
		expect(body.message).toContain('pnpm accounts:stand-in');
	});
});

describe('the access helpers', () => {
	const identity = (appRole: 'member' | 'admin' | null): Identity<'stream'> => ({
		app: 'stream',
		user: { id: 'ada', email: 'ada@keepr.digital', name: 'Ada' },
		sessionId: 's',
		organisation: { id: 'keepr', role: 'owner' },
		appRole,
		keeprAdministrator: true,
	});

	it.each([
		[
			"no App access, a Keepr Administrator's included",
			() => requireAppAccess(identity(null)),
			'NO_APP_ACCESS',
		],
		[
			'a lower App role than the one required',
			() => requireAppRole(identity('member'), 'admin'),
			'APP_ROLE_REQUIRED',
		],
	])('refuse %s, 403', (_case, require, code) => {
		expect(require).toThrow(
			expect.objectContaining({ statusCode: 403, data: expect.objectContaining({ code }) }),
		);
	});

	it.each([
		['the role itself', 'member', 'member'],
		['a higher role', 'admin', 'member'],
	] as const)('admit %s', (_case, held, required) => {
		expect(() => requireAppRole(identity(held), required)).not.toThrow();
	});
});
