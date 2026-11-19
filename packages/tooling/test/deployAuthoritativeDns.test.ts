import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type { Dns } from '../scripts/deploy/authoritative-dns.mjs';
import { fetchResolvingAtAuthority } from '../scripts/deploy/authoritative-dns.mjs';

const NAMESERVER = '192.0.2.53';

function dnsError(code: string, name: string) {
	return Object.assign(new Error(`query ${code} ${name}`), { code });
}

/**
 * The DNS boundary: `keepr.test` is a zone whose nameserver is at
 * NAMESERVER. The system resolver (`resolveNs`, `resolve4`) never knows the
 * zone's hosts, as a resolver still holding their NXDOMAIN would not; only a
 * query to NAMESERVER finds them.
 */
function fakeDns(hosts: Record<string, string[]>): Dns & { asked: string[] } {
	const asked: string[] = [];
	return {
		asked,
		async resolveNs(name) {
			if (name === 'keepr.test') return ['ns.keepr.test'];
			throw dnsError(name.endsWith('.keepr.test') ? 'ENOTFOUND' : 'ENODATA', name);
		},
		async resolve4(name) {
			if (name === 'ns.keepr.test') return [NAMESERVER];
			throw dnsError('ENOTFOUND', name);
		},
		authority(servers) {
			const at = (family: 4 | 6) => async (name: string) => {
				asked.push(`${servers.join(',')} A${family === 4 ? '' : 'AAAA'} ${name}`);
				const addresses = (hosts[name] ?? []).filter((address) =>
					family === 4 ? !address.includes(':') : address.includes(':'),
				);
				if (addresses.length) return addresses;
				throw dnsError(name in hosts ? 'ENODATA' : 'ENOTFOUND', name);
			};
			return { resolve4: at(4), resolve6: at(6) };
		},
	};
}

describe("fetching through a name's authoritative nameservers", () => {
	const servers: Server[] = [];

	afterEach(async () => {
		await Promise.all(
			servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))),
		);
	});

	async function origin() {
		const server = createServer((request, response) => {
			response.writeHead(200, { 'content-type': 'application/json' });
			response.end(JSON.stringify({ host: request.headers.host, path: request.url }));
		});
		servers.push(server);
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		return (server.address() as AddressInfo).port;
	}

	it('reaches a host only its zone knows, keeping its name as the Host', async () => {
		const port = await origin();
		const dns = fakeDns({ 'accounts.keepr.test': ['127.0.0.1'] });

		const response = await fetchResolvingAtAuthority({ dns })(
			`http://accounts.keepr.test:${port}/api/release`,
		);

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('application/json');
		expect(await response.json()).toEqual({
			host: `accounts.keepr.test:${port}`,
			path: '/api/release',
		});
		expect(dns.asked).toContain(`${NAMESERVER} A accounts.keepr.test`);
	});

	it.each([
		['a name its zone does not have', {}],
		['a name with no address', { 'accounts.keepr.test': [] }],
	])('rejects %s as fetch does an unresolved name, ENOTFOUND', async (_case, hosts) => {
		const port = await origin();

		const outcome: unknown = await fetchResolvingAtAuthority({ dns: fakeDns(hosts) })(
			`http://accounts.keepr.test:${port}/api/release`,
		).catch((error: unknown) => error);

		expect(outcome).toBeInstanceOf(TypeError);
		expect((outcome as { cause: { code: string } }).cause.code).toBe('ENOTFOUND');
	});
});
