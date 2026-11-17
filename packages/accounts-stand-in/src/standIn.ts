import type { IdentityProofClaims } from '@keepr/nuxt-layer/shared/utils/identityProof';
import { exportJWK, generateKeyPair, type JWK, SignJWT } from 'jose';
import {
	APP_REGISTRY,
	highestAppRole,
	type AppId,
} from '@keepr/nuxt-layer/shared/utils/appRegistry';
import {
	IDENTITY_PROOF_ALGORITHM,
	IDENTITY_PROOF_AUDIENCE,
	IDENTITY_PROOF_LIFETIME_SECONDS,
	IDENTITY_PROOF_PATH,
	KEEPR_ACCOUNTS_ORIGIN,
	PUBLIC_KEYS_PATH,
} from '@keepr/nuxt-layer/shared/utils/identityProof';

/** The Local Developer User, as the Accounts Stand-in names them. */
export const LOCAL_DEVELOPER = {
	id: 'local-developer',
	email: 'local.developer@keepr.invalid',
	name: 'Local Developer',
	sessionId: 'local-developer-session',
} as const;

/** The Keepr Organisation the Local Developer User works in: the same id every run. */
export const LOCAL_ORGANISATION_ID = 'keepr-local';

/**
 * Answers as Keepr Accounts does for an App, without anyone signing in: every
 * Identity Proof names the Local Developer User, a Keepr Administrator who owns
 * the Keepr Organisation and holds the highest App role in every App (ADR-0113).
 * It signs with the production issuer and audience, so an App's verifier has
 * no development branch, and with a key of its own, made on its first request, which
 * Keepr Accounts never publishes.
 */
/** Keepr Accounts' answers to an App, as the stand-in gives them. */
export interface AccountsStandIn {
	fetch: (request: Request) => Promise<Response>;
}

interface StandInKey {
	privateKey: CryptoKey;
	kid: string;
	jwk: JWK;
}

export function createAccountsStandIn(): AccountsStandIn {
	// Made on the first request: a Worker may not generate keys at global scope.
	let key: Promise<StandInKey> | undefined;
	const keyOf = (): Promise<StandInKey> => (key ??= makeKey());
	const makeKey = async (): Promise<StandInKey> => {
		const { privateKey, publicKey } = await generateKeyPair(IDENTITY_PROOF_ALGORITHM, {
			crv: 'Ed25519',
			extractable: true,
		});
		const kid = `accounts-stand-in-${crypto.randomUUID()}`;
		return {
			privateKey,
			kid,
			jwk: { ...(await exportJWK(publicKey)), kid, alg: IDENTITY_PROOF_ALGORITHM },
		};
	};

	const claims: IdentityProofClaims = {
		sid: LOCAL_DEVELOPER.sessionId,
		email: LOCAL_DEVELOPER.email,
		name: LOCAL_DEVELOPER.name,
		org: LOCAL_ORGANISATION_ID,
		orgRole: 'owner',
		apps: Object.fromEntries(
			(Object.keys(APP_REGISTRY) as AppId[]).map((app) => [app, highestAppRole(app)]),
		),
		keeprAdmin: true,
	};

	async function identityProof(): Promise<string> {
		const { privateKey, kid } = await keyOf();
		return await new SignJWT({ ...claims })
			.setProtectedHeader({ alg: IDENTITY_PROOF_ALGORITHM, kid })
			.setSubject(LOCAL_DEVELOPER.id)
			.setIssuer(KEEPR_ACCOUNTS_ORIGIN)
			.setAudience(IDENTITY_PROOF_AUDIENCE)
			.setIssuedAt()
			.setExpirationTime(`${IDENTITY_PROOF_LIFETIME_SECONDS}s`)
			.sign(privateKey);
	}

	return {
		async fetch(request: Request): Promise<Response> {
			const { pathname } = new URL(request.url);
			if (request.method === 'GET' && pathname === IDENTITY_PROOF_PATH)
				return Response.json({ token: await identityProof() });
			if (request.method === 'GET' && pathname === PUBLIC_KEYS_PATH)
				return Response.json({ keys: [(await keyOf()).jwk] });
			return new Response(
				`The Accounts Stand-in answers only ${IDENTITY_PROOF_PATH} and ${PUBLIC_KEYS_PATH}, as the Local Developer User. To sign in for real, run Keepr Accounts beside the App instead (apps/accounts/README.md).`,
				{ status: 404 },
			);
		},
	};
}
