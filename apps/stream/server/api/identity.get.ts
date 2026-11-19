import { requestIdentity } from '~~/server/utils/session';

/**
 * Who the browser is, as its Identity Proof says: what the layer's
 * `useIdentity` reads (`IDENTITY_PATH`), and the page gate with it.
 *
 * Behind the Session boundary like any other route, so it answers only a User
 * with App access to Stream Keepr. The boundary's 401 is what sends a
 * signed-out visitor to Keepr Accounts to sign in, and its 403 what tells a
 * User they have no access. The 401 is spelled again here, in the boundary's
 * own words, so this fails closed the day it stops being behind it.
 */
export default defineEventHandler(async (event) => {
	const identity = await requestIdentity(event);
	if (!identity) {
		throw createError({
			statusCode: 401,
			statusMessage: 'Unauthorized',
			message: 'Authentication is required',
		});
	}

	// Named for one browser, and renewed with its Session: never a shared cache's to keep.
	setResponseHeader(event, 'cache-control', 'private, no-store');
	return identity;
});
