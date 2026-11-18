import type { H3Event } from 'h3';
import { requestUserSession } from '~~/server/utils/auth';
import { decodeRoles, GRAPHICS_ADMINISTRATOR_ROLE } from '~~/server/utils/betterAuthRoles';

/**
 * Admit a signed-in User who holds the Graphics Administrator App role, and
 * answer who they are (ADR-0131).
 *
 * Every route under `/api/admin/` calls this. The session boundary in front of
 * them already refuses a request with no Session; the 401 is spelled again here,
 * in the boundary's own words, so a caller that stops being behind it fails
 * closed. The 401 and 403 are literals for `test/helpers/routeRefusalScan.ts`,
 * which reads a `const` only within the file it is reading.
 */
export async function requireGraphicsAdministrator(event: H3Event): Promise<string> {
	const session = await requestUserSession(event);
	if (!session) {
		throw createError({
			statusCode: 401,
			statusMessage: 'Unauthorized',
			message: 'Authentication is required',
		});
	}

	if (!decodeRoles(session.user.role).includes(GRAPHICS_ADMINISTRATOR_ROLE)) {
		throw createError({
			statusCode: 403,
			statusMessage: 'Forbidden',
			message: 'Graphics Administrator authorization is required',
		});
	}

	return session.user.id;
}
