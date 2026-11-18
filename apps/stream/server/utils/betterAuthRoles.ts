/**
 * The roles a User holds in Stream Keepr's own sign-in, as Better Auth's admin
 * add-on stores them: one comma-separated `role` column on the User (ADR-0131).
 *
 * This pair of functions is the whole of where that encoding is known. Its own
 * `parseRoles` joins an array the same way (`plugins/admin/routes.mjs`); these
 * are the reading half it has no export for.
 */

/**
 * The stored role that makes a User the Graphics Administrator, Stream Keepr's
 * App role (ADR-0131). The first-admin bootstrap grants it; the admin add-on
 * names it `admin`, and it is the highest App role Stream Keepr defines in the
 * App registry, which the Local Developer User holds.
 */
export const GRAPHICS_ADMINISTRATOR_ROLE = 'admin';

export function decodeRoles(role: string | null | undefined): string[] {
	return (role ?? '')
		.split(',')
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
}

export function encodeRoles(roles: readonly string[]): string {
	return roles.join(',');
}
