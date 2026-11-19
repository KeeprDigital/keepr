/**
 * Which pages a browser without a Session may reach.
 */

/**
 * The Screen Output page, the one page that renders without a Session.
 *
 * A Screen Output is credential-free in ADR-0010's sense: the Screen Output
 * Asset Capability already in its URL hash _is_ its credential, and the machine
 * showing it has no operator to sign in. Gating it would send program output
 * to Keepr Accounts' sign-in.
 *
 * Spelled as the route rather than read from page metadata because the near
 * miss is a single letter: `/event/12/screens/3` is the operator's Screen
 * control surface and is gated, while `/event/12/screen/main` is the output and
 * is not. `accessPageGate.test.ts` holds both spellings apart.
 */
const SCREEN_OUTPUT_PAGE = /^\/event\/[^/]+\/screen\/[^/]+\/?$/;

/**
 * Where a signed-in User with no App access to Stream Keepr is told so. It
 * reads nothing, so it stands for anyone: the page that says a User is not
 * admitted cannot itself ask whether they are.
 */
export const NO_ACCESS_PATH = '/no-access';

/**
 * Whether this page may be rendered only with a Session.
 *
 * Deny-by-default in the same sense ADR-0010 gives the Session boundary: a page
 * added tomorrow is gated without anyone remembering to gate it, and the two
 * exemptions are the whole of the exception list. Nobody signs in on a page of
 * Stream Keepr: a signed-out visitor is sent to Keepr Accounts (ADR-0141).
 */
export function pageRequiresSession(path: string): boolean {
	if (path === NO_ACCESS_PATH) return false;

	return !isScreenOutputPage(path);
}

/**
 * Whether this is the Screen Output page, which reads only through its Screen's
 * capability: the Event middleware leaves it alone too, because the operator's
 * Event read is private and the output loads its Event context itself (#604).
 */
export function isScreenOutputPage(path: string): boolean {
	return SCREEN_OUTPUT_PAGE.test(path);
}
