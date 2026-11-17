import type { IdentityDatabase } from '~~/server/db';
import type { AppId } from '@keepr/nuxt-layer/shared/utils/appRegistry';
import { APIError } from 'better-auth/api';
import { schema } from '~~/server/db';
import { isAppId, isAppRole } from '@keepr/nuxt-layer/shared/utils/appRegistry';

/** The App role offered or held in each App; an App left out is no access. */
export type AppRoles = Partial<Record<AppId, string>>;

/** What a refused set of App roles answers. */
export const APP_ROLE_NOT_IN_REGISTRY = 'APP_ROLE_NOT_IN_REGISTRY';

function refused(message: string): APIError {
	return APIError.from('BAD_REQUEST', { code: APP_ROLE_NOT_IN_REGISTRY, message });
}

/**
 * The App roles an Invitation offers, from the JSON it carries: each App one the
 * App registry names, each role one that App defines. Anything else is refused,
 * so App access is only ever assigned from the registry. None offered is `{}`.
 */
export function offeredAppRoles(json: unknown): AppRoles {
	if (json === undefined || json === null || json === '') return {};
	let parsed: unknown;
	try {
		parsed = typeof json === 'string' ? JSON.parse(json) : json;
	} catch {
		throw refused('The App roles offered are not readable.');
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
		throw refused('The App roles offered must name a role for each App.');
	const roles: AppRoles = {};
	for (const [app, role] of Object.entries(parsed)) {
		if (!isAppId(app)) throw refused(`No App is named ${app}.`);
		if (typeof role !== 'string' || !isAppRole(app, role))
			throw refused(`${app} defines no App role ${String(role)}.`);
		roles[app] = role;
	}
	return roles;
}

/** Gives a member the App access `roles` names: one row per App. */
export async function grantAppAccess(
	database: IdentityDatabase,
	memberId: string,
	roles: AppRoles,
): Promise<void> {
	const now = new Date();
	const rows = Object.entries(roles).map(([app, role]) => ({
		id: crypto.randomUUID(),
		memberId,
		app,
		role: role!,
		createdAt: now,
		updatedAt: now,
	}));
	if (rows.length > 0) await database.insert(schema.appAccess).values(rows);
}
