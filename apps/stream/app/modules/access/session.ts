/**
 * Who this browser is to Stream Keepr, client-side: the layer's `useIdentity`,
 * which asks this App's own "who am I" route and sends a signed-out visitor to
 * Keepr Accounts to sign in and back (ADR-0113, ADR-0141), and what the page
 * gate makes of each answer.
 */

/**
 * What this browser learned by asking.
 *
 * `unavailable` is deliberately not folded into `signed-out`. The two look
 * alike to a caller that only asks "is there a User?", but they are opposite
 * answers to the question the page gate asks: the server *said* there is no
 * Session, versus the server did not say. Only the first is grounds for taking
 * an operator away from the page they are on. ADR-0010 gates pages for UX and
 * leaves security to the Session boundary, so a blip during a navigation, or
 * Keepr Accounts being unreachable, must not cost a show its control surface.
 *
 * `no-access` is a signed-in User the Session boundary refuses on every route:
 * one with no App access to Stream Keepr.
 */
export type AccessStatus = 'signed-in' | 'signed-out' | 'no-access' | 'unavailable';

/** The status the Session boundary refuses a User with no App access with. */
const NO_APP_ACCESS_STATUS = 403;

/**
 * The ask currently in the air, so simultaneous callers share one request. The
 * page gate runs on every navigation, and a first navigation can fan out into
 * several before the first answer lands.
 */
let asking: Promise<AccessStatus> | null = null;

/** The Session this browser is working under, as Stream Keepr sees it. */
export function useAccess() {
	const { identity, load } = useIdentity<'stream'>();

	/**
	 * Asks the server who this browser is. A signed-out visitor is already on
	 * their way to Keepr Accounts when this answers: `useIdentity` sends them,
	 * and answers `null`. Only that is signed out: an answer that names nobody
	 * any other way is the server not having said.
	 * The identity route is a read, so its only 403 is the one for no App access.
	 */
	async function ask(): Promise<AccessStatus> {
		try {
			const answered = await load();
			if (answered === null) return 'signed-out';
			return answered ? 'signed-in' : 'unavailable';
		} catch (refusal) {
			return failureStatus(refusal) === NO_APP_ACCESS_STATUS ? 'no-access' : 'unavailable';
		}
	}

	/** Asks the server, unconditionally: what a surface does once a request of its own was refused 401. */
	function reload(): Promise<AccessStatus> {
		asking ??= ask().finally(() => {
			asking = null;
		});
		return asking;
	}

	/**
	 * The status, asking only if this browser holds no Identity. One it holds is
	 * settled: the server said so, and will say otherwise on the next request the
	 * page makes. Every other answer asks again, which is what makes an outage
	 * during one navigation recoverable by the next.
	 */
	async function ensure(): Promise<AccessStatus> {
		return identity.value ? 'signed-in' : await reload();
	}

	return { identity, ensure, load: reload };
}
