import { requireGraphicsAdministrator } from '~~/server/modules/graphics-administrator';
import { listUserAccounts } from '~~/server/modules/user-administration';
import { betterAuthUserAdministrationPort } from '~~/server/modules/user-administration/betterAuthPort';

/**
 * `GET /api/admin/users` — every account this installation holds (#399).
 *
 * Under `/api/admin/`, so the session boundary requires a Session, and guarded
 * by `requireGraphicsAdministrator`, which admits only a User holding the
 * Graphics Administrator App role (ADR-0131).
 */
export default defineEventHandler(async (event) => {
	await requireGraphicsAdministrator(event);

	return listUserAccounts(await betterAuthUserAdministrationPort());
});
