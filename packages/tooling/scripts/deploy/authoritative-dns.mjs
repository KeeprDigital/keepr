/**
 * A fetch whose hostnames resolve at their zone's authoritative nameservers,
 * past every cache: what `deploy:verify` asks once a name did not resolve
 * (ADR-0136). A custom domain a first deploy attaches is in its zone a moment
 * after the probe first asks, and the resolver that answered NXDOMAIN keeps
 * that answer for the zone's negative TTL (Cloudflare's: 30 minutes).
 *
 * The zone is the nearest name at or above the hostname with NS records, and
 * its nameservers' addresses, both found through the system's resolver: those
 * names exist, so no cached NXDOMAIN stands in their way. Only the hostname's
 * own addresses are asked of the nameservers themselves.
 *
 * It sends a GET with `node:http(s)`, which takes a `lookup`, and answers a
 * `Response`: never following a redirect, as `deploy:verify` asks of fetch.
 */

import { promises as dnsPromises } from 'node:dns';
import http from 'node:http';
import https from 'node:https';

/**
 * The DNS boundary: the system's resolver for the zone and its nameservers,
 * and a resolver that asks given nameservers directly.
 *
 * @typedef {{
 *   resolveNs(name: string): Promise<string[]>,
 *   resolve4(name: string): Promise<string[]>,
 *   authority(servers: string[]): {
 *     resolve4(name: string): Promise<string[]>,
 *     resolve6(name: string): Promise<string[]>,
 *   },
 * }} Dns
 */

/** @type {Dns} */
const systemDns = {
	resolveNs: (name) => dnsPromises.resolveNs(name),
	resolve4: (name) => dnsPromises.resolve4(name),
	authority(servers) {
		const resolver = new dnsPromises.Resolver({ timeout: 5_000, tries: 2 });
		resolver.setServers(servers);
		return resolver;
	},
};

/** Answers that mean "no such name, or no address for it". */
const NO_ADDRESS = new Set(['ENOTFOUND', 'ENODATA']);

/** @param {unknown} error */
const code = (error) => /** @type {{ code?: string } | undefined} */ (error)?.code;

/**
 * The addresses of the nameservers of the zone `hostname` is in.
 *
 * @param {string} hostname
 * @param {Dns} dns
 */
async function zoneNameservers(hostname, dns) {
	const labels = hostname.split('.');
	for (let index = 0; index < labels.length - 1; index += 1) {
		const name = labels.slice(index).join('.');
		let nameservers;
		try {
			nameservers = await dns.resolveNs(name);
		} catch (error) {
			if (NO_ADDRESS.has(code(error) ?? '')) continue;
			throw error;
		}
		if (nameservers.length === 0) continue;
		const addresses = (await Promise.allSettled(nameservers.map((ns) => dns.resolve4(ns)))).flatMap(
			(result) => (result.status === 'fulfilled' ? result.value : []),
		);
		if (addresses.length) return addresses;
	}
	throw Object.assign(new Error(`no nameservers found for the zone of ${hostname}`), {
		code: 'ENOTFOUND',
		hostname,
	});
}

/**
 * Every address the zone's nameservers hold for `hostname`, IPv4 first.
 *
 * @param {string} hostname
 * @param {Dns} dns
 * @returns {Promise<{ address: string, family: 4 | 6 }[]>}
 */
async function resolveAtAuthority(hostname, dns) {
	const authority = dns.authority(await zoneNameservers(hostname, dns));
	const answers = await Promise.allSettled([
		authority.resolve4(hostname),
		authority.resolve6(hostname),
	]);
	const failure = answers.find(
		(answer) => answer.status === 'rejected' && !NO_ADDRESS.has(code(answer.reason) ?? ''),
	);
	if (failure?.status === 'rejected') throw failure.reason;
	const [v4, v6] = answers.map((answer) => (answer.status === 'fulfilled' ? answer.value : []));
	const addresses = [
		...v4.map((address) => ({ address, family: /** @type {const} */ (4) })),
		...v6.map((address) => ({ address, family: /** @type {const} */ (6) })),
	];
	if (addresses.length === 0)
		throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), {
			code: 'ENOTFOUND',
			hostname,
		});
	return addresses;
}

/** Statuses whose Response has no body. */
const NULL_BODY = new Set([101, 204, 205, 304]);

/**
 * @param {{ dns?: Dns }} [options]
 * @returns {typeof fetch} a GET-only fetch: it reads the URL, `signal`, and nothing else
 */
export function fetchResolvingAtAuthority({ dns = systemDns } = {}) {
	/** @type {import('node:net').LookupFunction} */
	const lookup = (hostname, options, callback) => {
		resolveAtAuthority(hostname, dns).then(
			(addresses) =>
				options.all
					? callback(null, addresses)
					: callback(null, addresses[0].address, addresses[0].family),
			(error) => callback(error, ''),
		);
	};

	const fetchVia = (
		/** @type {string | URL | Request} */ input,
		/** @type {RequestInit} */ init = {},
	) =>
		new Promise((resolve, reject) => {
			const url = new URL(input instanceof Request ? input.url : input);
			const signal = init.signal ?? undefined;
			const client = url.protocol === 'https:' ? https : http;
			/** @param {unknown} error */
			const fail = (error) =>
				reject(signal?.aborted ? signal.reason : new TypeError('fetch failed', { cause: error }));
			const request = client.get(url, { lookup, signal, agent: false }, (response) => {
				/** @type {Buffer[]} */
				const chunks = [];
				response.on('data', (chunk) => chunks.push(chunk));
				response.on('error', fail);
				response.on('end', () => {
					const status = response.statusCode ?? 0;
					const headers = new Headers();
					for (let index = 0; index < response.rawHeaders.length; index += 2)
						headers.append(response.rawHeaders[index], response.rawHeaders[index + 1]);
					resolve(
						new Response(NULL_BODY.has(status) ? null : Buffer.concat(chunks), {
							status,
							headers,
						}),
					);
				});
			});
			request.on('error', fail);
		});
	return /** @type {typeof fetch} */ (/** @type {unknown} */ (fetchVia));
}
