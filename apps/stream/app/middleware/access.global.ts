import { NO_ACCESS_PATH, pageRequiresSession } from '~/modules/access/pageGate';
import { useAccess } from '~/modules/access/session';

/**
 * The client-side page gate (#395, ADR-0010's page-gating line).
 *
 * UX, not security. The wall is the deny-by-default Session boundary over
 * `/api/**`; this exists so a signed-out browser is sent to sign in, and a User
 * with no App access is told so, instead of either meeting a shell of pages
 * whose every request is refused.
 *
 * An exempt page is left completely alone: not asked about a Session, not
 * merely allowed past. That matters for the Screen Output page: a machine
 * showing program has no operator and no cookie, and a request from it asking
 * who it is would be a request nobody is there to answer for.
 *
 * A signed-out visitor is sent to Keepr Accounts by `useIdentity`, with the
 * page they were on to come back to; the navigation here is dropped, since
 * the browser is leaving. An `unavailable` answer means the browser could not
 * find out, and a gate that guessed there would take a control surface off an
 * operator mid-show over a blip: for a gate whose whole remit is UX, that costs
 * more than the shell it would have saved them from. `session.ts` carries the
 * rest of that argument.
 *
 * Nuxt runs global middleware in filename order, so this runs ahead of
 * `event.global`, the useful way round: a browser on its way to sign in does
 * not first load an Event it is not going to be shown.
 */
export default defineNuxtRouteMiddleware(async (to) => {
	// Every exemption is asked for in one place, so `pageRequiresSession` stays
	// the single home of "which pages may be seen without a Session".
	if (!pageRequiresSession(to.path)) return;

	const status = await useAccess().ensure();
	if (status === 'signed-out') return false;
	if (status === 'no-access') return navigateTo(NO_ACCESS_PATH);
});
