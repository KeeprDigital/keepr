// The cookie that tells the Accounts Stand-in who to answer as, in place of the
// Local Developer User. JavaScript, importing nothing, so a script Node runs
// with no build step names it as the stand-in itself does (`standIn.ts`).

/**
 * The cookie's name. An App forwards a request's cookies to Keepr Accounts, so
 * this reaches the stand-in exactly as a session cookie reaches Keepr Accounts.
 */
export const STAND_IN_COOKIE = 'keepr-stand-in';

/**
 * The cookie naming nobody else: the Local Developer User, in their one
 * Session. What the stand-in's sign-in gives a local browser, and what a
 * script or test sends to ask as them: an App asks Keepr Accounts nothing for
 * a request with no cookie of its own (ADR-0158).
 */
export const LOCAL_DEVELOPER_COOKIE = `${STAND_IN_COOKIE}=`;

/**
 * The Keepr Organisation the Local Developer User works in: the same id every
 * run, and the one every local Installation of an App names as its own, so a
 * local App admits whoever the stand-in answers as unless told otherwise
 * (ADR-0161, in `apps/stream/docs/adr`).
 */
export const LOCAL_ORGANISATION_ID = 'keepr-local';

/** The cookie's value for a visitor nobody is signed in as: the stand-in answers 401. */
export const STAND_IN_SIGNED_OUT = 'signed-out';

/** The cookie's value for an App the User has no App access to. */
export const STAND_IN_NO_APP_ACCESS = 'none';

/** The cookie's `org` for a User in no Organisation. */
export const STAND_IN_NO_ORGANISATION = 'none';

/**
 * @typedef {{
 *   user?: string | undefined,
 *   name?: string | undefined,
 *   session?: string | undefined,
 *   apps?: Record<string, string | null> | undefined,
 *   organisation?: { id: string, role: string } | null | undefined,
 *   keeprAdministrator?: boolean | undefined,
 * }} StandInPersona
 *   Who the stand-in answers as. Whatever is left out is the Local Developer
 *   User's: full authority, in the one Session. `user`: the User's id; its
 *   Session, name and email follow from it unless named. `session`: the
 *   Session's id, where a second one is a second signed-in browser of the same
 *   User. `apps`: the App role held in each App named, or `null` for no App
 *   access; an App left out keeps its highest role. `organisation`: the
 *   active Organisation and the Organisation role in it, or `null` for none;
 *   left out, the owner of the Keepr Organisation. `keeprAdministrator`:
 *   whether the User is a Keepr Administrator; left out, they are.
 */

/**
 * The `Cookie` header that makes the stand-in answer as `persona`, or refuse
 * as it would a signed-out visitor. Tests of a whole server send it; a browser
 * can be given it by hand (`README.md`).
 *
 * @param {StandInPersona | 'signed-out'} persona
 * @returns {string}
 */
export function standInCookie(persona) {
	if (persona === 'signed-out') return `${STAND_IN_COOKIE}=${STAND_IN_SIGNED_OUT}`;
	const fields = new URLSearchParams();
	if (persona.user !== undefined) fields.set('user', persona.user);
	if (persona.name !== undefined) fields.set('name', persona.name);
	if (persona.session !== undefined) fields.set('session', persona.session);
	for (const [app, role] of Object.entries(persona.apps ?? {}))
		fields.set(app, role ?? STAND_IN_NO_APP_ACCESS);
	if (persona.organisation === null) fields.set('org', STAND_IN_NO_ORGANISATION);
	else if (persona.organisation !== undefined) {
		fields.set('org', persona.organisation.id);
		fields.set('orgRole', persona.organisation.role);
	}
	if (persona.keeprAdministrator !== undefined)
		fields.set('keeprAdmin', String(persona.keeprAdministrator));
	return `${STAND_IN_COOKIE}=${fields.toString()}`;
}
