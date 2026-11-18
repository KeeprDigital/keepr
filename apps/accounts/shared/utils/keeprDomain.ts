/**
 * The domains Keepr's Installations are served under: production's, and
 * staging's, in an account of its own (ADR-0122). Every host of an Installation
 * is its domain or under it.
 */
export const KEEPR_DOMAINS = ['keepr.digital', 'keepr-staging.digital'] as const;

export type KeeprDomain = (typeof KEEPR_DOMAINS)[number];

/** The Keepr domain `host` (a hostname, or one with a port) is, or is under; none for any other host. */
export function keeprDomainOf(host: string): KeeprDomain | undefined {
	const hostname = host.replace(/:\d+$/, '').toLowerCase();
	return KEEPR_DOMAINS.find((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

/**
 * The Keepr domain of the Installation Keepr Accounts is served from at `host`:
 * the one it is under, or production's when it is under none (a local run).
 */
export function installationDomainOf(host: string): KeeprDomain {
	return keeprDomainOf(host) ?? 'keepr.digital';
}
