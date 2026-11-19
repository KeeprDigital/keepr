import type { H3Event } from 'h3';
import type { StreamIdentity } from '~~/server/utils/session';
import { requireAppRole } from '@keepr/nuxt-layer/server/utils/requestIdentity';
import { requestIdentity } from '~~/server/utils/session';

/**
 * The App role that makes a User the Graphics Administrator: the highest
 * Stream Keepr defines in the App registry (ADR-0131).
 */
export const GRAPHICS_ADMINISTRATOR_ROLE = 'admin';

/**
 * Admit a signed-in User whose Identity Proof names the Graphics Administrator
 * App role, and answer who they are (ADR-0131, ADR-0141).
 *
 * Every route under `/api/admin/` calls this. The Session boundary in front of
 * them already refuses a request with no Session; the 401 is spelled again
 * here, in the boundary's own words, as literals for
 * `test/helpers/routeRefusalScan.ts`, so a caller that stops being behind it
 * fails closed. A User without the role is refused by the layer's
 * `requireAppRole`, 403, as every App refuses one.
 */
export async function requireGraphicsAdministrator(event: H3Event): Promise<string> {
	return (await requireGraphicsAdministratorUser(event)).id;
}

/**
 * The same admission, answering the Graphics Administrator as their Identity
 * Proof names them: what a reading that names its actors names its reader by
 * (`server/utils/actorNames.ts`).
 */
export async function requireGraphicsAdministratorUser(
	event: H3Event,
): Promise<StreamIdentity['user']> {
	const identity = await requestIdentity(event);
	if (!identity) {
		throw createError({
			statusCode: 401,
			statusMessage: 'Unauthorized',
			message: 'Authentication is required',
		});
	}

	requireAppRole(identity, GRAPHICS_ADMINISTRATOR_ROLE);

	return identity.user;
}
