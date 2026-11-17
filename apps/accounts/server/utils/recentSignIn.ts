import type { Actor } from './actor';
import { RECENT_SIGN_IN_REQUIRED } from '~~/shared/utils/recentSignIn';
import { KeeprRefusal } from './refusal';

/**
 * How recent a sign-in a sensitive action needs: changing roles or App access,
 * removing a member, creating an Organisation, disabling a User (#1228 § Sessions
 * and cookies). Keepr Accounts' own check: the library's freshness check is off,
 * so that a User's list of their Sessions stays open to them.
 */
export const RECENT_SIGN_IN_MS = 10 * 60 * 1000;


/** Refuses 403 an Actor whose sign-in is more than ten minutes old at `now`. */
export function requireRecentSignIn(
	actor: Pick<Actor, 'signedInAt'>,
	now: Date = new Date(),
): void {
	if (now.getTime() - actor.signedInAt.getTime() > RECENT_SIGN_IN_MS)
		throw new KeeprRefusal(
			403,
			RECENT_SIGN_IN_REQUIRED,
			'Sign in again to do this: your sign-in is more than ten minutes old.',
		);
}
