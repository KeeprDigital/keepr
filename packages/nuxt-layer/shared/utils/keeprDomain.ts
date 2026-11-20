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

/**
 * Where an App reached at `origin` asks Keepr Accounts: its own Environment's,
 * on the Keepr domain the App is under, so the session cookie Keepr Accounts
 * renews is set on that domain and reaches the browser. Production's for any
 * other origin, or none. The issuer every Identity Proof names stays
 * production's whatever is asked (`KEEPR_ACCOUNTS_ORIGIN`).
 */
export function keeprAccountsOriginFor(origin: string | undefined): string {
	let host: string | undefined;
	try {
		host = origin === undefined ? undefined : new URL(origin).host;
	} catch {
		host = undefined;
	}
	return `https://accounts.${(host && keeprDomainOf(host)) ?? 'keepr.digital'}`;
}
