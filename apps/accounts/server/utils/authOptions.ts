import type { BetterAuthOptions } from 'better-auth';
import { admin, haveIBeenPwned, jwt, organization } from 'better-auth/plugins';

/**
 * Keepr Accounts' Better Auth configuration, everything but the database and the
 * secret, which exist only inside a running server. Tests build their instance
 * from this same function, so what they pin is what the server runs
 * (`RULES.md`, ADR-0112).
 *
 * Each option whose default depends on the environment is stated, for the reasons
 * Stream Keepr's census found (ADR-0012): the tests run under `NODE_ENV=test`,
 * where the library's defaults differ from a deployed Worker's.
 */

/** Where Keepr Accounts is served, and what an Identity Proof names as its issuer. */
export const KEEPR_ACCOUNTS_ORIGIN = 'https://accounts.keepr.digital';

/** The domain every Keepr host shares, on which the session cookie is set in production. */
export const KEEPR_DOMAIN = 'keepr.digital';

/** Who every Identity Proof is for: one audience for every App (#1256). */
export const IDENTITY_PROOF_AUDIENCE = 'https://keepr.digital';

/**
 * Sessions last seven days from their last renewal, and a request a day or more
 * after it renews. Stated so a library default changing cannot move them.
 */
export const SESSION_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 7;
export const SESSION_UPDATE_AGE_SECONDS = 60 * 60 * 24;

/** What a disabled User is told when they try to sign in. */
export const DISABLED_USER_MESSAGE =
	'This account has been disabled. Ask a Keepr Administrator to enable it again.';

/**
 * The hostnames Keepr Accounts answers on. The origin check trusts these and no
 * others, so an App's page cannot send a write here (#1228 § Further Notes).
 * Loopback is listed with any port, for the dev server and a local run of the
 * built Worker.
 */
export const ALLOWED_HOSTS = [
	'accounts.keepr.digital',
	'localhost',
	'localhost:*',
	'127.0.0.1',
	'127.0.0.1:*',
];

/**
 * The domain the session cookie is set on for a request to `host`: the shared
 * Keepr domain when Keepr Accounts is served on a Keepr host, so every App's
 * requests carry it, and none (host-only) anywhere else. A browser refuses a
 * cookie for `keepr.digital` from `localhost`, so local runs must be host-only.
 */
export function sharedCookieDomainFor(host: string): string | undefined {
	const hostname = host.replace(/:\d+$/, '').toLowerCase();
	return hostname === KEEPR_DOMAIN || hostname.endsWith(`.${KEEPR_DOMAIN}`)
		? KEEPR_DOMAIN
		: undefined;
}

const adminPlugin = admin({ bannedUserMessage: DISABLED_USER_MESSAGE });
const jwtPlugin = jwt({
	jwt: {
		issuer: KEEPR_ACCOUNTS_ORIGIN,
		audience: IDENTITY_PROOF_AUDIENCE,
		expirationTime: '5m',
	},
	disableSettingJwtHeader: true,
});

function httpPaths(plugin: { endpoints: Record<string, unknown> }): string[] {
	return Object.values(plugin.endpoints as Record<string, { path?: unknown }>)
		.map((endpoint) => endpoint.path)
		.filter((path) => typeof path === 'string');
}

/**
 * Paths no request may reach. The admin add-on's routes admit any
 * Keepr Administrator to everything it can do, impersonation and hard deletion
 * included; Keepr Accounts serves its own narrower routes instead. The signed-token
 * add-on's routes stay closed until the Identity Proof is built on them (#1228).
 * Derived from the add-ons, so a bump that adds a route closes it too.
 */
export const CLOSED_PATHS = [...httpPaths(adminPlugin), ...httpPaths(jwtPlugin)];

export function authOptions({ sharedCookieDomain }: { sharedCookieDomain: string | undefined }) {
	return {
		emailAndPassword: {
			enabled: true,
			// A User arrives by Invitation or by the first-administrator claim only.
			disableSignUp: true,
			revokeSessionsOnPasswordReset: true,
		},
		session: {
			expiresIn: SESSION_EXPIRES_IN_SECONDS,
			updateAge: SESSION_UPDATE_AGE_SECONDS,
			// Off, so signing out or disabling a User takes effect here at once: every
			// read of a Session goes to the database.
			cookieCache: { enabled: false },
		},
		plugins: [
			adminPlugin,
			organization({
				// Organisations are created on purpose, by a Keepr Administrator.
				allowUserToCreateOrganization: false,
				invitationExpiresIn: 60 * 60 * 24 * 7,
				cancelPendingInvitationsOnReInvite: true,
				membershipLimit: 10_000,
				invitationLimit: 10_000,
				schema: {
					invitation: {
						additionalFields: {
							// The App roles offered, as JSON: `{ "stream": "admin" }`.
							appRoles: { type: 'string', required: false, input: true },
						},
					},
				},
			}),
			jwtPlugin,
			haveIBeenPwned(),
		],
		disabledPaths: CLOSED_PATHS,
		baseURL: {
			allowedHosts: ALLOWED_HOSTS,
			fallback: KEEPR_ACCOUNTS_ORIGIN,
			// The scheme follows the request, so a local run over http is trusted too.
			protocol: 'auto',
		},
		advanced: {
			// Unstated, the check is off whenever `NODE_ENV` is `test` (ADR-0012).
			disableOriginCheck: false,
			// Written by Cloudflare on every request, after anything the caller sent
			// under that name is discarded: the one address a caller cannot choose.
			ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
			// `Secure` and `__Secure-` on every built server; the dev server keeps
			// the plain cookie a browser accepts over `http://localhost` (ADR-0012).
			useSecureCookies: import.meta.dev !== true,
			crossSubDomainCookies:
				sharedCookieDomain === undefined
					? { enabled: false }
					: { enabled: true, domain: sharedCookieDomain },
		},
		// On for every built server, and counted in the database so every isolate
		// shares one count per client (ADR-0012).
		rateLimit: {
			enabled: import.meta.dev !== true,
			storage: 'database',
		},
		telemetry: { enabled: false },
	} satisfies BetterAuthOptions;
}
