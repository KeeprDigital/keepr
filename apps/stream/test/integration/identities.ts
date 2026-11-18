import { anonymousFetch, fetch, url } from './client';
import {
	INTEGRATION_ADMIN_BOOTSTRAP_TOKEN,
	INTEGRATION_OPERATOR_EMAIL,
	INTEGRATION_OPERATOR_PASSWORD,
} from './environment';

/**
 * The two identities a graphics suite can need beyond the operator every request
 * already carries (#398, ADR-0010's credential model).
 *
 * This replaces `graphicsAuthorSession.ts`, and the replacement is not one-for-one
 * because the thing it replaced was one identity doing two jobs. A Graphics Author
 * Session was minted per browser and *was* the author, so "a second author" and "a
 * second browser" were the same helper called twice. They are now different
 * questions with different answers:
 *
 * - **A second person** owns different Graphics Ingestion Operations. `anotherUser`
 *   is what a scoping test needs — one author must not reach another's operation.
 * - **A second browser of the same person** holds a different Graphics Authoring
 *   Lease. `anotherBrowser` is what a lease test needs, and the fact that it is the
 *   **same** person is the point: one operator in two browsers is two editors, and a
 *   lease that let them through would let them overwrite each other in silence.
 *
 * A suite that needs neither needs nothing from here at all: `./client.ts` signs
 * every request as the operator, so the operator is the author, and the helpers a
 * suite used to call for "some author" are simply deleted.
 */

/**
 * Another person, signed in, as a cookie header.
 *
 * Made through the first-admin bootstrap because it is the only account-creating
 * route this installation has (#394) — the invite surface is a later ticket — and
 * because it is armed for the whole run anyway. The side effect is that every
 * invented person is a Graphics Administrator; `aUserWithoutTheRole` is the
 * person who is not.
 *
 * `label` is per-caller because two people who share an address are one person.
 * Suites that want a *stable* second person across a run should hold the returned
 * cookie rather than call this twice with the same label — the second call would
 * reset that account's password, which is harmless but pointless.
 */
export async function anotherUser(label: string): Promise<string> {
	const email = `${label}@keepr.digital`;
	const password = `${label}-password-398`;

	const ensured = await anonymousFetch('/api/bootstrap/ensure-admin', {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'x-admin-bootstrap-token': INTEGRATION_ADMIN_BOOTSTRAP_TOKEN,
		},
		body: JSON.stringify({ email, password, name: `Integration ${label}` }),
	});
	if (!ensured.ok)
		throw new Error(
			`The integration suite could not create '${label}': ${ensured.status} from the first-admin bootstrap.`,
		);

	return await signIn(email, password);
}

/**
 * A signed-in person who does not hold the Graphics Administrator role, as a
 * cookie header: what an admin route refuses 403 (ADR-0131).
 *
 * Invited the way an administrator invites anybody, through the user
 * administration surface the operator holds the role for: created with no role,
 * its link redeemed, then signed in. On a rerun against a persisted D1 the
 * account already exists, and a fresh link sets its password instead. One
 * sign-in per label per process.
 */
export function aUserWithoutTheRole(label: string): Promise<string> {
	let cookie = signedInWithoutTheRole.get(label);
	if (!cookie) {
		cookie = signInWithoutTheRole(label);
		signedInWithoutTheRole.set(label, cookie);
	}
	return cookie;
}

const signedInWithoutTheRole = new Map<string, Promise<string>>();

async function signInWithoutTheRole(label: string): Promise<string> {
	const email = `${label}@keepr.digital`;
	const password = `${label}-password-1293`;
	const json = { 'content-type': 'application/json' };

	const listing = (await (await fetch('/api/admin/users')).json()) as {
		users: { id: string; email: string }[];
	};
	const existing = listing.users.find((user) => user.email === email);
	const issued = existing
		? await fetch(`/api/admin/users/${existing.id}/password-reset-link`, {
				method: 'POST',
				headers: json,
			})
		: await fetch('/api/admin/users', {
				method: 'POST',
				headers: json,
				body: JSON.stringify({ email, name: `Integration ${label}` }),
			});
	if (!issued.ok)
		throw new Error(`The integration suite could not invite '${label}': ${issued.status}.`);

	const { passwordResetLink } = (await issued.json()) as { passwordResetLink: { url: string } };
	const token = new URLSearchParams(new URL(passwordResetLink.url).hash.slice(1)).get('token');
	const redeemed = await anonymousFetch('/api/auth/reset-password', {
		method: 'POST',
		headers: { ...json, origin: url('/') },
		body: JSON.stringify({ token, newPassword: password }),
	});
	if (!redeemed.ok)
		throw new Error(
			`The integration suite could not set '${label}''s password: ${redeemed.status}.`,
		);

	return await signIn(email, password);
}

/**
 * The operator again, in a second browser: the same person, a different Better
 * Auth session.
 *
 * Signing in a second time rather than reusing the process-wide cookie, because a
 * lease holder is a session id and two requests carrying one cookie are one
 * browser however many times they are sent.
 */
export async function anotherBrowser(): Promise<string> {
	return await signIn(INTEGRATION_OPERATOR_EMAIL, INTEGRATION_OPERATOR_PASSWORD);
}

async function signIn(email: string, password: string): Promise<string> {
	const response = await anonymousFetch('/api/auth/sign-in/email', {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			// Better Auth refuses a state-changing request with no `Origin` — the
			// same CSRF defence `client.ts` documents at its own sign-in.
			origin: url('/'),
		},
		body: JSON.stringify({ email, password }),
	});
	if (!response.ok)
		throw new Error(`The integration suite could not sign in as '${email}': ${response.status}.`);

	// Every cookie the response set, not the session token by name: the dev
	// server this suite spawns sets it unprefixed and a built server prefixes it
	// `__Secure-` (`useSecureCookies`, `server/utils/authOptions.ts`), and the
	// suite should not depend on which kind of server it is talking to.
	const cookie = response.headers
		.getSetCookie()
		.map((value) => value.split(';', 1)[0] ?? '')
		.filter((pair) => pair.includes('='))
		.join('; ');
	if (!cookie)
		throw new Error(
			`The integration suite signed in as '${email}' and was issued no session cookie.`,
		);

	return cookie;
}
