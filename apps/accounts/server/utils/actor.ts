import type { KeeprAuth } from './auth';
import { requestIsCrossSiteMutation } from '@keepr/nuxt-layer/server/utils/crossSiteMutation';
import { isKeeprAdministrator } from '~~/shared/utils/keeprAdministrator';
import { KeeprRefusal } from './refusal';

/**
 * Who is acting in a request to one of Keepr Accounts' own routes that needs a
 * Session: its User, whether they are a Keepr Administrator, and when they
 * signed in, which a sensitive action reads (`requireRecentSignIn`).
 */
export interface Actor {
	userId: string;
	keeprAdministrator: boolean;
	/** When this Session's sign-in was made. Renewing a Session does not move it. */
	signedInAt: Date;
}

/**
 * Refuses 403 a write another origin's page made the browser send, as the
 * layer's `requestIsCrossSiteMutation` reads it (ADR-0010). Every one of Keepr
 * Accounts' own routes runs it first, signed in or not (`answerRoute`).
 */
export function refuseCrossSiteWrite(request: Request): void {
	if (
		requestIsCrossSiteMutation({
			method: request.method,
			secFetchSite: request.headers.get('sec-fetch-site'),
			origin: request.headers.get('origin'),
			requestHost: new URL(request.url).host,
		})
	)
		throw new KeeprRefusal(403, 'CROSS_SITE_REQUEST', 'Cross-site request refused.');
}

/**
 * The Actor `request` is made by; a request with no open Session is refused 401,
 * a disabled User's among them (`openAuthRoutes.ts`).
 */
export async function requestActor(auth: KeeprAuth, request: Request): Promise<Actor> {
	const signedIn = await auth.api.getSession({ headers: request.headers });
	if (!signedIn) throw new KeeprRefusal(401, 'SIGNED_OUT', 'Sign in to do this.');
	return {
		userId: signedIn.user.id,
		keeprAdministrator: isKeeprAdministrator(signedIn.user.role),
		signedInAt: new Date(signedIn.session.createdAt),
	};
}
