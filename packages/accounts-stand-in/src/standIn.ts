import type { IdentityProofClaims } from '@keepr/nuxt-layer/shared/utils/identityProof';
import type { StandInPersona } from './cookie.mjs';
import { exportJWK, generateKeyPair, type JWK, SignJWT } from 'jose';
import { APP_IDS, highestAppRole } from '@keepr/nuxt-layer/shared/utils/appRegistry';
import {
	IDENTITY_PROOF_ALGORITHM,
	IDENTITY_PROOF_AUDIENCE,
	IDENTITY_PROOF_LIFETIME_SECONDS,
	IDENTITY_PROOF_PATH,
	KEEPR_ACCOUNTS_ORIGIN,
	PUBLIC_KEYS_PATH,
} from '@keepr/nuxt-layer/shared/utils/identityProof';
import {
	askedUserIds,
	USER_NAMES_MAX_IDS,
	USER_NAMES_PATH,
	type UserNamesAnswer,
} from '@keepr/nuxt-layer/shared/utils/userNames';
import { STAND_IN_COOKIE, STAND_IN_NO_APP_ACCESS, STAND_IN_SIGNED_OUT } from './cookie.mjs';

export { STAND_IN_COOKIE, standInCookie, type StandInPersona } from './cookie.mjs';

/** The Local Developer User, as the Accounts Stand-in names them. */
export const LOCAL_DEVELOPER = {
	id: 'local-developer',
	email: 'local.developer@keepr.invalid',
	name: 'Local Developer',
	sessionId: 'local-developer-session',
} as const;

/** The Keepr Organisation the Local Developer User works in: the same id every run. */
export const LOCAL_ORGANISATION_ID = 'keepr-local';

/** The stand-in cookie's value in a `Cookie` header, or `undefined` when it carries none. */
function standInCookieValue(header: string | null): string | undefined {
	for (const pair of (header ?? '').split(';')) {
		const separator = pair.indexOf('=');
		if (separator !== -1 && pair.slice(0, separator).trim() === STAND_IN_COOKIE)
			return pair.slice(separator + 1).trim();
	}
	return undefined;
}

/** Who a request's cookies ask the stand-in to answer as: a persona, or nobody. */
function personaOf(header: string | null): StandInPersona | 'signed-out' {
	const value = standInCookieValue(header);
	if (value === undefined) return {};
	if (value === STAND_IN_SIGNED_OUT) return 'signed-out';
	const fields = new URLSearchParams(value);
	const apps: Record<string, string | null> = {};
	for (const app of APP_IDS) {
		const role = fields.get(app);
		if (role !== null) apps[app] = role === STAND_IN_NO_APP_ACCESS ? null : role;
	}
	return {
		user: fields.get('user') ?? undefined,
		name: fields.get('name') ?? undefined,
		session: fields.get('session') ?? undefined,
		apps,
	};
}

/** Keepr Accounts' answers to an App, as the stand-in gives them. */
export interface AccountsStandIn {
	fetch: (request: Request) => Promise<Response>;
}

interface StandInKey {
	privateKey: CryptoKey;
	kid: string;
	jwk: JWK;
}

/**
 * Answers as Keepr Accounts does for an App, without anyone signing in: every
 * Identity Proof names the Local Developer User, a Keepr Administrator who owns
 * the Keepr Organisation and holds the highest App role in every App (ADR-0113),
 * unless the request's `keepr-stand-in` cookie names someone else, or nobody.
 * It signs with the production issuer and audience, so an App's verifier has
 * no development branch, and with a key of its own, made on its first request, which
 * Keepr Accounts never publishes.
 *
 * It holds no Users. The ones it can name to an App (ADR-0145) are the Local
 * Developer User and whoever it has answered as since it started, by the name
 * it gave them last: locally a User exists once a request has named them.
 * Everyone works in the one Organisation, so each is named to anyone signed in.
 */
export function createAccountsStandIn(): AccountsStandIn {
	const namesAnsweredAs = new Map<string, string>([[LOCAL_DEVELOPER.id, LOCAL_DEVELOPER.name]]);

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

	async function identityProof(persona: StandInPersona): Promise<string> {
		const user = persona.user ?? LOCAL_DEVELOPER.id;
		const isLocalDeveloper = user === LOCAL_DEVELOPER.id;
		const apps: Record<string, string> = {};
		for (const app of APP_IDS) {
			const role = persona.apps?.[app];
			if (role === undefined) apps[app] = highestAppRole(app);
			else if (role !== null) apps[app] = role;
		}
		const claims: IdentityProofClaims = {
			sid: persona.session ?? `${user}-session`,
			email: isLocalDeveloper ? LOCAL_DEVELOPER.email : `${user}@keepr.invalid`,
			name: persona.name ?? (isLocalDeveloper ? LOCAL_DEVELOPER.name : user),
			org: LOCAL_ORGANISATION_ID,
			orgRole: 'owner',
			apps,
			keeprAdmin: true,
		};
		namesAnsweredAs.set(user, claims.name);
		const { privateKey, kid } = await keyOf();
		return await new SignJWT({ ...claims })
			.setProtectedHeader({ alg: IDENTITY_PROOF_ALGORITHM, kid })
			.setSubject(user)
			.setIssuer(KEEPR_ACCOUNTS_ORIGIN)
			.setAudience(IDENTITY_PROOF_AUDIENCE)
			.setIssuedAt()
			.setExpirationTime(`${IDENTITY_PROOF_LIFETIME_SECONDS}s`)
			.sign(privateKey);
	}

	return {
		async fetch(request: Request): Promise<Response> {
			const { pathname } = new URL(request.url);
			if (request.method === 'GET' && pathname === IDENTITY_PROOF_PATH) {
				const persona = personaOf(request.headers.get('cookie'));
				// As Keepr Accounts answers a request with no Session.
				if (persona === 'signed-out') return new Response(null, { status: 401 });
				return Response.json({ token: await identityProof(persona) });
			}
			if (request.method === 'GET' && pathname === PUBLIC_KEYS_PATH)
				return Response.json({ keys: [(await keyOf()).jwk] });
			if (request.method === 'GET' && pathname === USER_NAMES_PATH) {
				// Refused as Keepr Accounts refuses: a signed-out visitor, and too long a question.
				if (personaOf(request.headers.get('cookie')) === 'signed-out')
					return new Response(null, { status: 401 });
				const ids = askedUserIds(new URL(request.url));
				if (ids.length > USER_NAMES_MAX_IDS) return new Response(null, { status: 400 });
				const names: UserNamesAnswer['names'] = {};
				for (const id of ids) {
					const name = namesAnsweredAs.get(id);
					if (name?.trim()) names[id] = name;
				}
				return Response.json({ names } satisfies UserNamesAnswer);
			}
			return new Response(
				`The Accounts Stand-in answers only ${IDENTITY_PROOF_PATH}, ${PUBLIC_KEYS_PATH} and ${USER_NAMES_PATH}, as the Local Developer User. To sign in for real, run Keepr Accounts beside the App instead (apps/accounts/README.md).`,
				{ status: 404 },
			);
		},
	};
}
