import type { KeeprAuth } from './auth';
import { requestIsCrossSiteMutation } from '@keepr/nuxt-layer/server/utils/crossSiteMutation';
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
 * The Actor `request` is made by. A write another origin's page made a
 * signed-in browser send is refused 403 before its Session is read, as Stream
 * Keepr's boundary refuses one (ADR-0010); a request with no open Session 401.
 */
export async function requestActor(auth: KeeprAuth, request: Request): Promise<Actor> {
	if (
		requestIsCrossSiteMutation({
			method: request.method,
			secFetchSite: request.headers.get('sec-fetch-site'),
			origin: request.headers.get('origin'),
			requestHost: new URL(request.url).host,
		})
	)
		throw new KeeprRefusal(403, 'CROSS_SITE_REQUEST', 'Cross-site request refused.');
	const signedIn = await auth.api.getSession({ headers: request.headers });
	if (!signedIn) throw new KeeprRefusal(401, 'SIGNED_OUT', 'Sign in to do this.');
	return {
		userId: signedIn.user.id,
		// The admin add-on keeps several roles comma-separated.
		keeprAdministrator:
			typeof signedIn.user.role === 'string' && signedIn.user.role.split(',').includes('admin'),
		signedInAt: new Date(signedIn.session.createdAt),
	};
}
