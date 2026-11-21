/**
 * The signed-in operator an acceptance run works as (#396, ADR-0141).
 *
 * Every path in `routes.mjs` except the Screen Output surface sits behind
 * ADR-0010's deny-by-default Session boundary, so a harness nobody vouches for
 * gets 401 from the first request it makes and proves nothing. Who vouches
 * depends on where the run is pointed, and that is a stated choice, never
 * inferred:
 *
 * - **A local run needs no password.** The installation it targets was started
 *   through the Accounts Stand-in (`pnpm preview`, `pnpm dev`), whose cookie
 *   names the Local Developer User (ADR-0113, ADR-0158). The harness sends that
 *   cookie, and says it is nobody with the stand-in's signed-out one.
 * - **A deployed run signs in to Keepr Accounts**, as the operator named in the
 *   environment. A User signs in only there (ADR-0112): the harness posts the
 *   credentials to the Installation's Keepr Accounts and carries the Session
 *   cookie it is given, which every host under the Keepr domain accepts.
 *
 * The decision is a pure function so it can be exercised in every state without
 * an installation in front of it; only `openOperatorSession` performs requests.
 */

import process from 'node:process';
import { LOCAL_DEVELOPER_COOKIE, standInCookie } from '@keepr/accounts-stand-in/cookie';
import { AcceptanceFailure } from './evidence.mjs';

/** Where a deployed run says who it signs in as. */
export const OPERATOR_EMAIL_ENV = 'STREAM_KEEPR_ACCEPTANCE_OPERATOR_EMAIL';
export const OPERATOR_PASSWORD_ENV = 'STREAM_KEEPR_ACCEPTANCE_OPERATOR_PASSWORD';

/**
 * Names the Keepr Accounts a deployed run signs in to, for an Installation
 * whose own cannot be read off its host.
 */
export const ACCOUNTS_ORIGIN_ENV = 'STREAM_KEEPR_ACCEPTANCE_ACCOUNTS_ORIGIN';

/** Keepr Accounts' host under an Installation's Keepr domain, and its sign-in route. */
const ACCOUNTS_HOST_LABEL = 'accounts';
const SIGN_IN_ROUTE = '/api/auth/sign-in/email';

/**
 * What a local run sends to ask as a signed-out visitor: the Accounts
 * Stand-in's own word for it, which reaches the stand-in as a request with no
 * cookie at all would not (ADR-0158).
 */
export const LOCAL_SIGNED_OUT_COOKIE = standInCookie('signed-out');

/** A value the environment can actually supply, or undefined. */
function usable(value) {
	return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

/**
 * How this run intends to become somebody, or a named failure if it cannot.
 *
 * A deployed run is never given anything of this checkout's: its two names come
 * from the shell that started it, and nothing local is read.
 *
 * @param {{ deployed?: boolean, env?: Record<string, string | undefined> }} options
 */
export function operatorCredentialPlan({ deployed = false, env = {} }) {
	if (!deployed) return { kind: 'stand-in' };

	const email = usable(env[OPERATOR_EMAIL_ENV]);
	const password = usable(env[OPERATOR_PASSWORD_ENV]);
	if (email && password) return { kind: 'sign-in', email, password };

	// Prose first, then the code, exactly as the local-configuration preflight
	// does it: the reader needs the two names, and the detail a formatter will
	// print cannot carry a secret or a long value.
	process.stderr.write(`${operatorUnavailableNotice()}\n`);
	throw new AcceptanceFailure('harness-operator-unavailable', { mode: 'deployed' });
}

/** What to set, and why a deployed run stopped before it opened anything. */
export function operatorUnavailableNotice() {
	return (
		`This run has no operator to sign in as, and every route behind the Session boundary answers 401 ` +
		`without one, so nothing would have been proved. Set ${OPERATOR_EMAIL_ENV} and ` +
		`${OPERATOR_PASSWORD_ENV} to a User of the Installation's Keepr Accounts who holds the Graphics ` +
		`Administrator App role in Stream Keepr: the run signs in there as them.`
	);
}

/**
 * The Keepr Accounts an Installation relies on: the `accounts` host of its
 * Keepr domain, so `stream.keepr-staging.digital` signs in at
 * `accounts.keepr-staging.digital` and never at Production's (ADR-0122).
 *
 * @param {string} origin The Stream Keepr Installation's origin.
 * @param {Record<string, string | undefined>} [env]
 */
export function keeprAccountsOriginOf(origin, env = {}) {
	const named = usable(env[ACCOUNTS_ORIGIN_ENV]);
	if (named) return new URL(named).origin;

	const url = new URL(origin);
	const labels = url.hostname.split('.');
	if (url.protocol !== 'https:' || labels.length < 3) {
		throw new AcceptanceFailure('harness-operator-unavailable', {
			step: 'sign-in',
			reason: 'accounts-origin-unknown',
		});
	}
	return `https://${[ACCOUNTS_HOST_LABEL, ...labels.slice(1)].join('.')}`;
}

/**
 * Whether this origin is a server on this machine.
 *
 * The acceptance harnesses answer that question with their `--deployed` flag,
 * which they already thread through everything. The measurement probes in
 * `scripts/` have no such flag: they take one mandatory `PROBE_ORIGIN`, so for
 * them the question really is about the host.
 *
 * `0.0.0.0` counts because a server bound to it and addressed by it is the local
 * one; a hostname that merely resolves to a loopback address does not, since
 * nothing here resolves names and guessing would be the wrong way round.
 *
 * @param {string} origin
 */
export function isLoopbackOrigin(origin) {
	try {
		const { hostname } = new URL(origin);
		return ['127.0.0.1', 'localhost', '::1', '[::1]', '0.0.0.0'].includes(hostname);
	} catch {
		return false;
	}
}

/**
 * Every cookie a response set, as `name=value` pairs.
 *
 * All of them rather than the Session cookie by name, so the harness does not
 * depend on how Keepr Accounts spells it. Pairs rather than one folded header,
 * because both consumers need them separately: a request header joins them
 * with `; `, and the acceptance browser installs each one in its own jar entry.
 */
export function sessionCookiePairs(response) {
	return response.headers
		.getSetCookie()
		.map((cookie) => cookie.split(';', 1)[0])
		.filter((pair) => pair.includes('='));
}

/**
 * Open the run's Session, returning its cookie pairs, which every later request
 * carries: for a local run the Accounts Stand-in's cookie, which names the
 * Local Developer User, as a request with none is signed out (ADR-0158).
 *
 * A deployed run posts its credentials to Keepr Accounts and nowhere else, with
 * the `Origin` a page of Keepr Accounts would send: a write to its sign-in is
 * admitted only from itself (`apps/accounts/RULES.md` § Session), and `fetch`
 * in Node sends none. Both failures are `harness-operator-unavailable` rather
 * than an unmet precondition: the Installation is answering, this run simply
 * has no identity on it.
 *
 * @param {string} origin The Stream Keepr Installation's origin.
 * @param {{ deployed?: boolean, env?: Record<string, string | undefined>, fetchRequest?: typeof fetch }} options
 */
export async function openOperatorSession(
	origin,
	{ deployed = false, env = process.env, fetchRequest = fetch } = {},
) {
	const plan = operatorCredentialPlan({ deployed, env });
	if (plan.kind === 'stand-in') return [LOCAL_DEVELOPER_COOKIE];

	const accountsOrigin = keeprAccountsOriginOf(origin, env);
	const signIn = await fetchRequest(`${accountsOrigin}${SIGN_IN_ROUTE}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', origin: accountsOrigin },
		body: JSON.stringify({ email: plan.email, password: plan.password }),
		redirect: 'manual',
	});
	if (!signIn.ok) {
		throw new AcceptanceFailure('harness-operator-unavailable', {
			step: 'sign-in',
			actual: signIn.status,
		});
	}

	const cookies = sessionCookiePairs(signIn);
	if (cookies.length === 0) {
		throw new AcceptanceFailure('harness-operator-unavailable', {
			step: 'sign-in',
			reason: 'no session cookie',
		});
	}

	return cookies;
}

/**
 * Open a Session against one origin, deciding from the origin alone whether it
 * is this machine's.
 *
 * For the callers that have no `--deployed` flag: the measurement probes take a
 * single mandatory origin. The acceptance harnesses keep passing `deployed`
 * explicitly, because they have it: a run's mode is a stated choice there, not
 * something to infer from a hostname.
 *
 * @param {string} origin
 */
export async function openOperatorSessionForOrigin(origin) {
	return await openOperatorSession(origin, { deployed: !isLoopbackOrigin(origin) });
}
