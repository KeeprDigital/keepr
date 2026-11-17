const KEEPR_DOMAIN = 'keepr.digital';
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1']);

/**
 * The Return Address a User is sent to after signing in, or `null` when
 * `candidate` is not one Keepr Accounts will send anyone to (`RULES.md`).
 *
 * Accepted: a page of Keepr Accounts itself, and any page on a Keepr host over
 * https. A loopback address is accepted only when Keepr Accounts is itself served
 * from one (`servedFrom`), so a deployment never sends anyone to a local address.
 */
export function acceptedReturnAddress(
	candidate: string | null | undefined,
	servedFrom: string,
): string | null {
	if (!candidate) return null;

	// A path of this site. `//` and `/\` are read by browsers as another host.
	if (/^\/(?![/\\])/.test(candidate)) return candidate;

	let address: URL;
	try {
		address = new URL(candidate);
	} catch {
		return null;
	}
	if (address.username || address.password) return null;

	const keeprHost =
		address.protocol === 'https:' &&
		(address.hostname === KEEPR_DOMAIN || address.hostname.endsWith(`.${KEEPR_DOMAIN}`));
	const localHost =
		LOOPBACK_HOSTNAMES.has(new URL(servedFrom).hostname) &&
		(address.protocol === 'http:' || address.protocol === 'https:') &&
		LOOPBACK_HOSTNAMES.has(address.hostname);

	return keeprHost || localHost ? address.href : null;
}
