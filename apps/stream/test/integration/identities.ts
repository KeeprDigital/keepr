import { standInCookie } from '@keepr/accounts-stand-in/cookie';
import { INTEGRATION_OPERATOR_ID, INTEGRATION_OPERATOR_NAME } from './environment';

/**
 * Who a suite can ask as beyond the operator every request already asks as
 * (#398, ADR-0010's credential model, ADR-0141).
 *
 * Each is a `Cookie` header naming a User, a Session or an App role to the
 * Accounts Stand-in the server runs beside, which answers with that Identity
 * Proof as Keepr Accounts answers a Session cookie. Nothing is created: Stream
 * Keepr holds no Users, so a User exists for as long as a request names them.
 *
 * "A second author" and "a second browser" are different questions with
 * different answers:
 *
 * - **A second User** owns different Graphics Ingestion Operations. `anotherUser`
 *   is what a scoping test needs: one author must not reach another's operation.
 * - **A second Session of the same User** holds a different Graphics Authoring
 *   Lease. `anotherBrowser` is what a lease test needs, and the fact that it is
 *   the **same** User is the point: one operator in two browsers is two editors.
 *
 * A suite that needs neither needs nothing from here at all: `./client.ts` asks
 * as the operator on every request.
 *
 * Each answers a promise, as it did when an identity had to sign in, so a suite
 * awaits it either way.
 */

/**
 * Another User, with the highest App role, as a cookie header. `label` is
 * per-caller because two Users who share an id are one User.
 */
export async function anotherUser(label: string): Promise<string> {
	return standInCookie({ user: label, name: `Integration ${label}` });
}

/**
 * A signed-in User whose App role is `member`, not the Graphics Administrator's:
 * what an admin route refuses 403 (ADR-0131).
 */
export async function aUserWithoutTheRole(label: string): Promise<string> {
	return standInCookie({ user: label, name: `Integration ${label}`, apps: { stream: 'member' } });
}

/** A signed-in User with no App access to Stream Keepr: what every route refuses 403. */
export async function aUserWithoutAccess(label: string): Promise<string> {
	return standInCookie({ user: label, name: `Integration ${label}`, apps: { stream: null } });
}

let browsers = 1;

/**
 * The operator again, in a second browser: the same User, a different Session.
 * A lease holder is a Session, and two requests carrying one Session are one
 * browser however many times they are sent.
 */
export async function anotherBrowser(): Promise<string> {
	browsers += 1;
	return standInCookie({
		user: INTEGRATION_OPERATOR_ID,
		name: INTEGRATION_OPERATOR_NAME,
		session: `${INTEGRATION_OPERATOR_ID}-browser-${browsers}`,
	});
}
