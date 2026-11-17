import type { IdentityProofSource } from './identityProof';
import type { BetterAuthOptions } from 'better-auth';
import type { EmailSender } from '~~/server/email/sender';
import type { OrganisationRecords } from './organisations';
import { admin, haveIBeenPwned, jwt, organization } from 'better-auth/plugins';
import {
	IDENTITY_PROOF_AUDIENCE,
	IDENTITY_PROOF_LIFETIME_SECONDS,
	KEEPR_ACCOUNTS_ORIGIN,
} from '@keepr/nuxt-layer/shared/utils/identityProof';
import { passwordResetEmail } from '~~/server/email/messages';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '~~/shared/utils/newPassword';
import { organisationOptions } from './organisations';

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

/** The domain every Keepr host shares, on which the session cookie is set in production. */
export const KEEPR_DOMAIN = 'keepr.digital';

/**
 * Sessions last seven days from their last renewal, and a request a day or more
 * after it renews. Stated so a library default changing cannot move them.
 */
export const SESSION_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 7;
export const SESSION_UPDATE_AGE_SECONDS = 60 * 60 * 24;

/** How long an Invitation stays open: seven days. */
export const INVITATION_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 7;

/** How long an emailed reset link works: one hour, and once. */
export const RESET_LINK_EXPIRES_IN_SECONDS = 60 * 60;

/** Keepr Accounts' page a reset link opens, its token in the fragment so no server logs it. */
export function resetPasswordLink(origin: string, token: string): string {
	return `${origin}/reset-password#token=${encodeURIComponent(token)}`;
}

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

function httpPaths(plugin: { endpoints: Record<string, unknown> }): string[] {
	return Object.values(plugin.endpoints as Record<string, { path?: unknown }>)
		.map((endpoint) => endpoint.path)
		.filter((path) => typeof path === 'string');
}

/**
 * Paths no request may reach. The admin add-on's routes admit any
 * Keepr Administrator to everything it can do, impersonation and hard deletion
 * included; Keepr Accounts serves its own narrower routes instead. Derived from
 * the add-on, so a bump that adds a route closes it too.
 */
export const CLOSED_PATHS = httpPaths(adminPlugin);

/**
 * The organisation add-on's routes that change a member, closed because Keepr
 * Accounts serves its own (`memberManagement.ts`): these would ask for no recent
 * sign-in, admit no Keepr Administrator, and leave App access out of the Audit
 * Record.
 */
export const MEMBER_PATHS_KEEPR_SERVES = [
	'/organization/update-member-role',
	'/organization/remove-member',
];

/**
 * The organisation add-on's routes that rename or delete an Organisation, closed
 * because nothing in Keepr does either: they would be open to its owners, and
 * leave no row in the Audit Record.
 */
export const ORGANISATION_PATHS_CLOSED = ['/organization/update', '/organization/delete'];

export interface AuthOptionsInput {
	sharedCookieDomain: string | undefined;
	/** Where the email a request causes is sent. */
	email: EmailSender;
	/**
	 * Takes work a response must not wait for, sending email above all, and keeps
	 * it running after the answer. Without one, the response waits for it.
	 */
	afterResponse?: (work: Promise<unknown>) => void;
	/** Where App access and the Audit Record are written as Organisations change. */
	organisations: OrganisationRecords;
	/** What an Identity Proof names, and the Organisation a new Session works in. */
	identityProof: IdentityProofSource;
}

export function authOptions({
	sharedCookieDomain,
	email,
	afterResponse,
	organisations,
	identityProof,
}: AuthOptionsInput) {
	return {
		emailAndPassword: {
			enabled: true,
			// A User arrives by Invitation or by the first-administrator claim only.
			disableSignUp: true,
			minPasswordLength: MIN_PASSWORD_LENGTH,
			maxPasswordLength: MAX_PASSWORD_LENGTH,
			resetPasswordTokenExpiresIn: RESET_LINK_EXPIRES_IN_SECONDS,
			revokeSessionsOnPasswordReset: true,
			// Handed to `afterResponse`, so how long sending takes cannot tell a caller
			// whether the address has a User.
			sendResetPassword: async ({ user, url, token }) =>
				await email.send(
					passwordResetEmail({
						to: user.email,
						name: user.name,
						link: resetPasswordLink(new URL(url).origin, token),
					}),
				),
		},
		session: {
			expiresIn: SESSION_EXPIRES_IN_SECONDS,
			updateAge: SESSION_UPDATE_AGE_SECONDS,
			// Off, so signing out or disabling a User takes effect here at once: every
			// read of a Session goes to the database.
			cookieCache: { enabled: false },
			// Off. The library's own freshness check would close a User's list of their
			// Sessions a day after they signed in; how recent a sign-in a sensitive action
			// needs is Keepr Accounts' own check (#1228 § Sessions and cookies).
			freshAge: 0,
		},
		plugins: [
			adminPlugin,
			organization({
				// Organisations are created on purpose, by a Keepr Administrator.
				allowUserToCreateOrganization: false,
				invitationExpiresIn: INVITATION_EXPIRES_IN_SECONDS,
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
				...organisationOptions({
					email,
					records: organisations,
					fallbackOrigin: KEEPR_ACCOUNTS_ORIGIN,
				}),
			}),
			// The Identity Proof: `GET /api/auth/token` mints it from the session cookie,
			// and `GET /api/auth/jwks` publishes the keys it verifies against (ADR-0113).
			jwt({
				jwt: {
					// Fixed, never read from the request: unstated, they are blank whenever
					// `baseURL` is a list of hosts (#1256).
					issuer: KEEPR_ACCOUNTS_ORIGIN,
					audience: IDENTITY_PROOF_AUDIENCE,
					expirationTime: `${IDENTITY_PROOF_LIFETIME_SECONDS}s`,
					definePayload: (session) => identityProof.claims(session),
				},
				jwks: { keyPairConfig: { alg: 'EdDSA', crv: 'Ed25519' } },
				// Nothing reads a token on every `get-session`; minting one there is waste.
				disableSettingJwtHeader: true,
			}),
			haveIBeenPwned(),
		],
		databaseHooks: {
			session: {
				create: {
					// The organisation add-on leaves a new Session in no Organisation, so its
					// Identity Proof would name none until the User chose one (#1256).
					before: async (session) => ({
						data: {
							...session,
							activeOrganizationId:
								(session as { activeOrganizationId?: string | null }).activeOrganizationId ??
								(await identityProof.activeOrganizationAtSignIn(session.userId)),
						},
					}),
				},
			},
		},
		disabledPaths: [...CLOSED_PATHS, ...MEMBER_PATHS_KEEPR_SERVES, ...ORGANISATION_PATHS_CLOSED],
		baseURL: {
			allowedHosts: ALLOWED_HOSTS,
			fallback: KEEPR_ACCOUNTS_ORIGIN,
			// The scheme follows the request, so a local run over http is trusted too.
			protocol: 'auto',
		},
		advanced: {
			...(afterResponse && { backgroundTasks: { handler: afterResponse } }),
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
