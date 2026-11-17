// Spike 2 (#1256). Throwaway: an App turning the browser's cookie into a
// verified Identity Proof, asking Keepr Accounts over the service binding.
import { createLocalJWKSet, jwtVerify, SignJWT, generateKeyPair, type JSONWebKeySet } from 'jose';

const ISSUER = 'https://accounts.keepr.digital';
const AUDIENCE = 'https://keepr.digital';
const ACCOUNTS_ORIGIN = 'https://accounts.keepr.digital';

interface Env { ACCOUNTS: Fetcher }

let jwks: ReturnType<typeof createLocalJWKSet> | null = null;
let jwksFetches = 0;
async function publicKeys(env: Env, refresh = false) {
	if (!jwks || refresh) {
		jwksFetches += 1;
		const res = await env.ACCOUNTS.fetch(`${ACCOUNTS_ORIGIN}/api/auth/jwks`);
		jwks = createLocalJWKSet((await res.json()) as JSONWebKeySet);
	}
	return jwks;
}

async function verify(env: Env, token: string, refreshed = false): Promise<Record<string, unknown>> {
	try {
		const { payload, protectedHeader } = await jwtVerify(token, await publicKeys(env, refreshed), {
			issuer: ISSUER, audience: AUDIENCE, algorithms: ['EdDSA'],
		});
		return { ok: true, jwksFetches, protectedHeader, payload };
	} catch (error) {
		const code = (error as { code?: string }).code;
		// An unknown kid may be a rotated key: refetch the published keys once.
		if (code === 'ERR_JWKS_NO_MATCHING_KEY' && !refreshed) return verify(env, token, true);
		return { ok: false, jwksFetches, code, message: (error as Error).message };
	}
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === '/whoami') {
			const res = await env.ACCOUNTS.fetch(`${ACCOUNTS_ORIGIN}/api/auth/token`, {
				headers: { cookie: request.headers.get('cookie') ?? '' },
			});
			const renewed = res.headers.getSetCookie();
			if (!res.ok) return Response.json({ accountsStatus: res.status, body: await res.text() }, { status: 401 });
			const { token } = (await res.json()) as { token: string };
			const headers = new Headers();
			for (const c of renewed) headers.append('set-cookie', c);
			return Response.json({ renewedCookies: renewed.length, ...(await verify(env, token)) }, { headers });
		}
		if (url.pathname === '/verify') {
			return Response.json(await verify(env, url.searchParams.get('token') ?? ''));
		}
		// A token signed by a key Keepr Accounts never published.
		if (url.pathname === '/unknown-key') {
			const { privateKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
			const token = await new SignJWT({ sub: 'mallory' })
				.setProtectedHeader({ alg: 'EdDSA', kid: 'not-a-published-kid' })
				.setIssuer(ISSUER).setAudience(AUDIENCE).setExpirationTime('5m').sign(privateKey);
			return Response.json(await verify(env, token));
		}
		return new Response('not found', { status: 404 });
	},
};
