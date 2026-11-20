import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import { isDisabled } from './identityProof';

/**
 * Better Auth's routes Keepr Accounts leaves open (#1385): what its own pages
 * and every App call, and nothing else. Every other route the library ships,
 * one a later version adds included, answers 404, so the surface is closed by
 * default rather than by a list of what to close. `openAuthRoutes.sqlite.test.ts`
 * holds every route the library ships against this list.
 */
export const OPEN_AUTH_ROUTES: ReadonlySet<string> = new Set([
	// Signing in and out (`/sign-in`, the profile).
	'/sign-in/email',
	'/sign-out',
	'/get-session',
	// The profile: a User's name, password and Sessions, and the Organisation they work in.
	'/update-user',
	'/change-password',
	'/list-sessions',
	'/revoke-session',
	'/organization/set-active',
	// Resetting a password (`/forgot-password`, `/reset-password`).
	'/request-password-reset',
	'/reset-password',
	// The Identity Proof and the keys it verifies against, which every App asks (ADR-0113).
	'/token',
	'/jwks',
]);

/** The path a request names under `basePath`, as the library's router reads it. */
export function authRoutePath(url: string, basePath: string): string {
	const pathname = new URL(url).pathname.replace(/\/+$/, '') || '/';
	const base = basePath.replace(/\/+$/, '');
	if (base === '' || !pathname.startsWith(`${base}/`)) return pathname;
	return pathname.slice(base.length).replace(/\/+$/, '') || '/';
}

/** The add-on that closes every route but `OPEN_AUTH_ROUTES`, and keeps the open ones honest. */
export const openAuthRoutesOnly = {
	id: 'keepr-open-auth-routes',
	async onRequest(request, context) {
		const path = authRoutePath(request.url, new URL(context.baseURL).pathname);
		if (!OPEN_AUTH_ROUTES.has(path))
			return { response: new Response('Not Found', { status: 404 }) };
	},
	hooks: {
		before: [
			{
				// By slug, it would tell anyone signed in which Organisations exist: an
				// unknown slug answers otherwise than one they are not a member of.
				matcher: (context) => context.path === '/organization/set-active',
				handler: createAuthMiddleware(async (context) => {
					const body = context.body as { organizationSlug?: unknown } | undefined;
					if (body?.organizationSlug !== undefined)
						throw APIError.from('BAD_REQUEST', {
							code: 'ORGANISATION_ID_REQUIRED',
							message: 'Name the Organisation by its id.',
						});
				}),
			},
			{
				// A disabled User is refused on every route, not only where an Identity Proof
				// is minted: a Session of theirs is ended the first time any route is sent
				// it, and the route then answers as it answers no Session.
				matcher: () => true,
				handler: createAuthMiddleware(async (context) => {
					const session = await getSessionFromCtx(context, { disableRefresh: true });
					// Read here without renewing it; the route reads it again, and renews it.
					context.context.session = null;
					if (session && isDisabled(session.user as { banned?: unknown; banExpires?: unknown }))
						await context.context.internalAdapter.deleteUserSessions(session.user.id);
				}),
			},
		],
	},
} satisfies BetterAuthPlugin;
