import type { AppId, AppRole } from './appRegistry';
import { isAppId, isAppRole } from './appRegistry';

/**
 * The Identity Proof: what Keepr Accounts signs about one request, and what an
 * App reads from it (root `GLOSSARY.md`, ADR-0112). Keepr Accounts mints it and
 * the layer's `resolveRequestIdentity` checks it, so both read this one shape.
 */

/** Where Keepr Accounts is served, and the issuer every Identity Proof names. */
export const KEEPR_ACCOUNTS_ORIGIN = 'https://accounts.keepr.digital';

/** Who every Identity Proof is for: one audience for every App (#1256). */
export const IDENTITY_PROOF_AUDIENCE = 'https://keepr.digital';

/** How long an Identity Proof is good for, and so how long a revocation takes to reach an App. */
export const IDENTITY_PROOF_LIFETIME_SECONDS = 5 * 60;

/** The one algorithm an Identity Proof is signed with. */
export const IDENTITY_PROOF_ALGORITHM = 'EdDSA';

/** Keepr Accounts' "cookie in, Identity Proof out" path. */
export const IDENTITY_PROOF_PATH = '/api/auth/token';

/** Where Keepr Accounts publishes the keys its Identity Proofs verify against. */
export const PUBLIC_KEYS_PATH = '/api/auth/jwks';

/** Keepr Accounts' sign-in page, which takes the Return Address as `?returnTo=`. */
export const SIGN_IN_PATH = '/sign-in';

/**
 * Every App calls Keepr Accounts by this service name, and nothing else
 * registers under it but Keepr Accounts and, locally, the Accounts Stand-in
 * (ADR-0113).
 */
export const KEEPR_ACCOUNTS_SERVICE = 'keepr-accounts';

/**
 * The cookies Keepr Accounts reads: its own, under the prefix the library
 * gives them on a built server or none on the dev server, and locally the
 * Accounts Stand-in's, which stands in for a session cookie (ADR-0113).
 */
const KEEPR_ACCOUNTS_COOKIE = /^(?:(?:__Secure-)?better-auth\..+|keepr-stand-in)$/;

/**
 * The cookies of a `Cookie` header that are Keepr Accounts' own, in the order
 * sent: all an App passes on when it asks, so no cookie of the App's own, or of
 * another App on the Keepr domain, reaches Keepr Accounts. `''` for none.
 */
export function keeprAccountsCookies(header: string | undefined): string {
	return (header ?? '')
		.split(';')
		.map((pair) => pair.trim())
		.filter((pair) => KEEPR_ACCOUNTS_COOKIE.test(pair.split('=', 1)[0]!))
		.join('; ');
}

/** The binding an App names the connection to Keepr Accounts by. */
export const KEEPR_ACCOUNTS_BINDING = 'KEEPR_ACCOUNTS';

/** Where an App answers "who am I" for its own pages (`readRequestIdentity`). */
export const IDENTITY_PATH = '/api/identity';

/** The Organisation roles, lowest first: the one list Keepr Accounts and every App read. */
export const ORGANISATION_ROLES = ['member', 'admin', 'owner'] as const;
export type OrganisationRole = (typeof ORGANISATION_ROLES)[number];

/** Whether `role` is an Organisation role: what a membership, an Invitation and an Identity Proof must hold. */
export function isOrganisationRole(role: unknown): role is OrganisationRole {
	return (ORGANISATION_ROLES as readonly unknown[]).includes(role);
}

/** The claims Keepr Accounts adds to an Identity Proof, beside `sub`, `iss`, `aud`, `iat` and `exp`. */
export interface IdentityProofClaims {
	/** The Session's id. */
	sid: string;
	email: string;
	name: string;
	/** The active Organisation's id, or `null` for a User in none. */
	org: string | null;
	orgRole: OrganisationRole | null;
	/** App to App role, naming only the Apps the User has access to. */
	apps: Record<string, string>;
	/** Whether the User is a Keepr Administrator. */
	keeprAdmin: boolean;
}

/** Who a request belongs to, as one App sees it. */
export interface Identity<App extends AppId = AppId> {
	/** The App this Identity was read for, whose App role `appRole` is. */
	app: App;
	user: { id: string; email: string; name: string };
	sessionId: string;
	/** The active Organisation and the User's Organisation role in it, or `null`. */
	organisation: { id: string; role: OrganisationRole } | null;
	/** The App role held in the calling App, or `null` for no App access. */
	appRole: AppRole<App> | null;
	keeprAdministrator: boolean;
}

/**
 * What an App's "who am I" route tells its pages (`IDENTITY_PATH`): the User and
 * their App role. The Session, the Organisation and whether the User is a Keepr
 * Administrator stay on the server, which is all that decides with them.
 */
export type PageIdentity<App extends AppId = AppId> = Pick<Identity<App>, 'user' | 'appRole'>;

/** `identity` as a page is told it. */
export function pageIdentityOf<App extends AppId>(identity: Identity<App>): PageIdentity<App> {
	return { user: identity.user, appRole: identity.appRole };
}

/**
 * The Identity one App reads from a verified Identity Proof's payload. An App
 * role the registry does not define for `app` is no App access, so a proof
 * minted against a newer registry never grants a role this App does not know.
 */
export function identityFromClaims<App extends AppId>(
	app: App,
	payload: Record<string, unknown>,
): Identity<App> {
	const claims = payload as Partial<IdentityProofClaims> & { sub?: unknown };
	const orgRole = isOrganisationRole(claims.orgRole) ? claims.orgRole : null;
	const role = isAppId(app) ? claims.apps?.[app] : undefined;
	return {
		app,
		user: {
			id: String(claims.sub),
			email: String(claims.email ?? ''),
			name: String(claims.name ?? ''),
		},
		sessionId: String(claims.sid),
		organisation:
			typeof claims.org === 'string' && orgRole ? { id: claims.org, role: orgRole } : null,
		appRole: typeof role === 'string' && isAppRole(app, role) ? role : null,
		keeprAdministrator: claims.keeprAdmin === true,
	};
}

/** Keepr Accounts' sign-in page at `accountsOrigin`, returning to `returnTo` afterwards. */
export function signInAddress(accountsOrigin: string, returnTo: string): string {
	const address = new URL(SIGN_IN_PATH, accountsOrigin);
	address.searchParams.set('returnTo', returnTo);
	return address.toString();
}
