/** The admin add-on's role that marks a Keepr Administrator (ADR-0112). */
export const KEEPR_ADMINISTRATOR_ROLE = 'admin';

/**
 * Whether a User's admin add-on role marks a Keepr Administrator. The add-on
 * keeps several roles comma-separated, so the mark is one among them.
 */
export function isKeeprAdministrator(role: unknown): boolean {
	return typeof role === 'string' && role.split(',').includes(KEEPR_ADMINISTRATOR_ROLE);
}
