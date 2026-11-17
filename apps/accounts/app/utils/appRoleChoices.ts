import type { AppId } from '@keepr/nuxt-layer/shared/utils/appRegistry';
import { APP_IDS, APP_REGISTRY } from '@keepr/nuxt-layer/shared/utils/appRegistry';

/** The choice of no App access, beside each App role. */
export const NO_ACCESS = 'none';

/** Each App the App registry names, with its App roles to choose from, no access first. */
export const APP_ROLE_CHOICES = APP_IDS.map((app) => ({
	app,
	name: APP_REGISTRY[app].name,
	items: [
		{ label: 'No access', value: NO_ACCESS },
		...APP_REGISTRY[app].roles.map((role) => ({ label: role, value: role })),
	],
}));

/** No App access in any App, as a form starts. */
export function noAppAccess(): Record<AppId, string> {
	return Object.fromEntries(APP_IDS.map((app) => [app, NO_ACCESS])) as Record<AppId, string>;
}

/** The App roles chosen, leaving out each App with no access. */
export function chosenAppRoles(choices: Record<AppId, string>): Partial<Record<AppId, string>> {
	return Object.fromEntries(Object.entries(choices).filter(([, role]) => role !== NO_ACCESS));
}

/** The Organisation roles, lowest first. */
export const ORGANISATION_ROLE_CHOICES = [
	{ label: 'Member', value: 'member' },
	{ label: 'Admin', value: 'admin' },
	{ label: 'Owner', value: 'owner' },
];
