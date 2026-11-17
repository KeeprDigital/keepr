/**
 * The App registry: each App, and the App roles it defines (root `GLOSSARY.md`).
 * Keepr Accounts assigns App access only from here, so adding an App or a role
 * is a change to this list, never to the identity schema.
 *
 * Every App starts with `member` and `admin`, placeholders nothing yet tells
 * apart (#1228).
 */
export const APP_REGISTRY = {
	stream: { name: 'Stream Keepr', roles: ['member', 'admin'] },
	score: { name: 'Score Keepr', roles: ['member', 'admin'] },
} as const satisfies Record<string, { name: string; roles: readonly string[] }>;

/** An App's id in the registry, as App access and the Identity Proof name it. */
export type AppId = keyof typeof APP_REGISTRY;

/** The App roles one App defines. */
export type AppRole<App extends AppId = AppId> = (typeof APP_REGISTRY)[App]['roles'][number];

/** Whether `app` is an App the registry names. */
export function isAppId(app: string): app is AppId {
	return Object.hasOwn(APP_REGISTRY, app);
}

/** Whether `role` is one `app` defines: what an assignment of App access must be. */
export function isAppRole<App extends AppId>(app: App, role: string): role is AppRole<App> {
	return (APP_REGISTRY[app].roles as readonly string[]).includes(role);
}
