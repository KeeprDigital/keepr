import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createServer } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Release } from '../scripts/deploy/release.mjs';
import {
	DeployVerifyFailure,
	verifyDeployment,
	verifyInstallation,
} from '../scripts/deploy/verify.mjs';

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

const HTML = 'text/html; charset=utf-8';
const SPA_FALLBACK = '<!DOCTYPE html><html><body><div id="__nuxt"></div></body></html>';
const READING = '{"serverTime":1760000000000}';

/**
 * A stand-in for a deployed origin on localhost: real HTTP, no deployment, no
 * credentials, no network beyond loopback. The probe's rules are driven through
 * the exported probe; what verifying an Installation adds to it (the target,
 * the release identity it expects, what it claims) through `verifyInstallation`.
 */
describe('deploy:verify against a local stand-in origin', () => {
	const servers: Server[] = [];

	afterEach(async () => {
		vi.unstubAllGlobals();
		await Promise.all(
			servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))),
		);
	});

	async function origin(handler: Handler) {
		const server = createServer(handler);
		servers.push(server);
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	}

	function json(body: unknown, status = 200): Handler {
		return (_request, response) => {
			response.writeHead(status, { 'content-type': 'application/json' });
			response.end(JSON.stringify(body));
		};
	}

	// The script's own retry policy, without its real five-second pauses.
	const fast = { attempts: 3, retryDelayMs: 0 };

	interface WrongAnswer {
		answer: string;
		status?: number;
		contentType?: string;
		location?: string;
		body?: string;
		named: RegExp;
	}

	it.each<WrongAnswer>([
		{
			answer: 'a redirect to a sign-in page',
			status: 302,
			location: '/login',
			named: /302.*\/login/,
		},
		{
			answer: 'a 200 HTML page such as an SPA fallback',
			contentType: HTML,
			body: SPA_FALLBACK,
			named: /text\/html/,
		},
		{
			answer: 'a JSON content type whose body does not parse',
			body: '{"serverTime": 17',
			named: /not valid JSON/,
		},
		{ answer: 'a JSON null', body: 'null', named: /serverTime/ },
		{ answer: 'a JSON array', body: `[${READING}]`, named: /serverTime/ },
		{ answer: 'a string serverTime', body: '{"serverTime":"1760000000000"}', named: /serverTime/ },
		{
			answer: 'a fractional serverTime',
			body: '{"serverTime":1760000000000.5}',
			named: /serverTime/,
		},
		{ answer: 'a non-positive serverTime', body: '{"serverTime":0}', named: /serverTime/ },
		{
			answer: 'a JSON error envelope',
			body: '{"statusCode":503,"message":"Service Unavailable"}',
			named: /serverTime/,
		},
		{
			answer: 'status 201 with a clock-reading body',
			status: 201,
			body: READING,
			named: /answered 201/,
		},
		{
			answer: 'status 401 with a clock-reading body',
			status: 401,
			body: READING,
			named: /answered 401/,
		},
	])(
		'fails $answer on its first answer, following and retrying nothing',
		async ({ status = 200, contentType = 'application/json', location, body, named }) => {
			const requested: string[] = [];
			// Every other path answers the clock reading, so a redirect that was followed would pass.
			const url = await origin((request, response) => {
				requested.push(request.url ?? '');
				if (request.url !== '/api/time')
					return response.writeHead(200, { 'content-type': 'application/json' }).end(READING);
				response
					.writeHead(status, {
						'content-type': contentType,
						...(location ? { location } : {}),
					})
					.end(body);
			});

			const outcome: unknown = await verifyDeployment({ baseUrl: url, ...fast }).catch(
				(error: unknown) => error,
			);

			expect(outcome).toBeInstanceOf(DeployVerifyFailure);
			expect((outcome as DeployVerifyFailure).message).toMatch(named);
			expect(requested).toEqual(['/api/time']);
		},
	);

	it.each([
		'not a url',
		'ftp://127.0.0.1',
		'127.0.0.1:3000',
		'http://127.0.0.1:9/?preview=1',
		'http://127.0.0.1:9/#top',
	])('refuses the target %j without probing anything', async (target) => {
		const fetchRequest = vi.fn();

		const outcome: unknown = await verifyDeployment({
			baseUrl: target,
			fetchRequest: fetchRequest as unknown as typeof fetch,
			...fast,
		}).catch((error: unknown) => error);

		expect(outcome).toBeInstanceOf(DeployVerifyFailure);
		expect((outcome as DeployVerifyFailure).message).toContain('KEEPR_DEPLOY_URL');
		expect(fetchRequest).not.toHaveBeenCalled();
	});

	describe('retrying what a fresh promotion can still be settling', () => {
		it('fails an origin that keeps answering 503, after every attempt', async () => {
			let requests = 0;
			const url = await origin((_request, response) => {
				requests += 1;
				response.writeHead(503, { 'content-type': 'text/plain' });
				response.end('Service Unavailable');
			});

			const failure = verifyDeployment({ baseUrl: url, ...fast });

			await expect(failure).rejects.toBeInstanceOf(DeployVerifyFailure);
			await expect(failure).rejects.toThrow(/answered 503/);
			expect(requests).toBe(3);
		});

		it('passes once a 503 settles into the clock reading', async () => {
			let requests = 0;
			const url = await origin((request, response) => {
				requests += 1;
				if (requests === 1) {
					response.writeHead(503);
					return response.end();
				}
				json({
					serverTime: Date.now(),
				})(request, response);
			});

			await expect(verifyDeployment({ baseUrl: url, ...fast })).resolves.toMatchObject({
				url: `${url}/api/time`,
			});
			expect(requests).toBe(2);
		});

		it('fails an origin nothing is listening on, after every attempt', async () => {
			// What Node's fetch rejects with on a closed port. A port bound and
			// released here could be taken again before the probe connected.
			const fetchRequest = vi.fn(async () => {
				throw new TypeError('fetch failed', {
					cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:443'), {
						code: 'ECONNREFUSED',
					}),
				});
			});

			const failure = verifyDeployment({
				baseUrl: 'https://127.0.0.1',
				fetchRequest: fetchRequest as unknown as typeof fetch,
				...fast,
			});

			await expect(failure).rejects.toBeInstanceOf(DeployVerifyFailure);
			await expect(failure).rejects.toThrow(/could not be reached \(ECONNREFUSED\)/);
			expect(fetchRequest).toHaveBeenCalledTimes(3);
		});

		it('fails an origin that accepts the connection and never answers, after every attempt', async () => {
			const url = await origin(() => {});
			// Counted where the probe asks: a request its timeout cuts off may never reach the origin.
			const fetchRequest = vi.fn((...request: Parameters<typeof fetch>) => fetch(...request));

			await expect(
				verifyDeployment({
					baseUrl: url,
					fetchRequest: fetchRequest as unknown as typeof fetch,
					...fast,
					timeoutMs: 25,
				}),
			).rejects.toThrow(/could not be reached/);
			expect(fetchRequest).toHaveBeenCalledTimes(3);
		});
	});

	// A deploy that "succeeded" while the previous Worker still answers has not
	// promoted anything: `/api/release` names which Release serves (#525 f).
	describe('requiring the release identity', () => {
		const IDENTITY = { app: 'stream', version: '1.8.0', commit: 'c'.repeat(40) };

		it('passes when /api/release names the Release just deployed', async () => {
			const requested: string[] = [];
			const url = await origin((request, response) => {
				requested.push(request.url ?? '');
				json(IDENTITY)(request, response);
			});

			await expect(
				verifyDeployment({ baseUrl: url, expected: IDENTITY, ...fast }),
			).resolves.toMatchObject({ url: `${url}/api/release` });
			expect(requested).toEqual(['/api/release']);
		});

		it('fails while the previous Release still answers, naming both, after every attempt', async () => {
			let requests = 0;
			const url = await origin((request, response) => {
				requests += 1;
				json({ ...IDENTITY, version: '1.7.0', commit: 'b'.repeat(40) })(request, response);
			});

			const failure = verifyDeployment({ baseUrl: url, expected: IDENTITY, ...fast });

			await expect(failure).rejects.toThrow(/stream@1\.7\.0.*stream@1\.8\.0/);
			expect(requests).toBe(3);
		});

		it('passes once the new Release takes over from the previous one', async () => {
			let requests = 0;
			const url = await origin((request, response) => {
				requests += 1;
				json(requests === 1 ? { ...IDENTITY, version: '1.7.0' } : IDENTITY)(request, response);
			});

			await expect(
				verifyDeployment({ baseUrl: url, expected: IDENTITY, ...fast }),
			).resolves.toBeDefined();
			expect(requests).toBe(2);
		});

		it.each([
			['another app', { ...IDENTITY, app: 'accounts' }],
			['another commit of the same version', { ...IDENTITY, commit: 'd'.repeat(40) }],
		])('fails when it names %s', async (_case, answer) => {
			const url = await origin(json(answer));

			await expect(
				verifyDeployment({ baseUrl: url, expected: IDENTITY, ...fast }),
			).rejects.toBeInstanceOf(DeployVerifyFailure);
		});

		it('fails at once on an answer that is not a release identity', async () => {
			let requests = 0;
			const url = await origin((request, response) => {
				requests += 1;
				json({ serverTime: Date.now() })(request, response);
			});

			await expect(verifyDeployment({ baseUrl: url, expected: IDENTITY, ...fast })).rejects.toThrow(
				/app, version, commit/,
			);
			expect(requests).toBe(1);
		});
	});

	describe("verifying an Installation: the Environment's URL, or KEEPR_DEPLOY_URL", () => {
		const loopbackFetch = fetch;
		const COMMIT = 'c'.repeat(40);

		function release(verifies: Release['verifies']): Release {
			return {
				app: 'stream',
				appDir: '/release/apps/stream',
				version: '1.8.0',
				verifies,
				descriptor: {
					app: 'stream',
					build: [],
					output: '.output',
					worker: { config: '.output/server/wrangler.json' },
					databases: [],
					environments: { production: { url: 'https://stream.keepr.digital' } },
					parts: {},
				},
			};
		}

		// The Environment's URL is production. Every fetch it could make is this
		// stand-in, which sends on only what is for the local origin and refuses the
		// rest with an answer the probe fails on at once: a target read wrongly is never asked.
		async function verify(target: string, standIn: string, verifies: Release['verifies']) {
			const asked: string[] = [];
			const printed: string[] = [];
			const fetchRequest = (async (...request: Parameters<typeof fetch>) => {
				const url = String(request[0]);
				asked.push(url);
				return url.startsWith(`${standIn}/`)
					? loopbackFetch(...request)
					: new Response('not the stand-in origin', { status: 421 });
			}) as typeof fetch;
			vi.stubGlobal('fetch', fetchRequest);

			const outcome = await verifyInstallation({
				release: release(verifies),
				environment: 'production',
				commit: COMMIT,
				env: { KEEPR_DEPLOY_URL: target },
				fetchRequest,
				log: (line: string) => void printed.push(line),
				...fast,
			}).catch((error: unknown) => error);

			return { outcome, asked, output: printed.join('\n') };
		}

		it('requires a Release with a descriptor to name itself', async () => {
			const url = await origin(json({ app: 'stream', version: '1.8.0', commit: COMMIT }));

			const { outcome, asked, output } = await verify(`${url}/`, url, 'release');

			expect(outcome).toBe('release');
			expect(asked).toEqual([`${url}/api/release`]);
			expect(output).toContain(`stream@1.8.0 (${COMMIT})`);
			expect(output).not.toContain('liveness only');
		});

		it('checks a Release from before /api/release for liveness only, and says so', async () => {
			const url = await origin(json({ serverTime: Date.now() }));

			const { outcome, asked, output } = await verify(url, url, 'liveness');

			expect(outcome).toBe('liveness');
			expect(asked).toEqual([`${url}/api/time`]);
			expect(output).toContain('liveness only');
			expect(output).toContain('predates /api/release');
		});

		it('fails on a wrong answer, naming it and claiming nothing', async () => {
			const url = await origin((_request, response) => {
				response.writeHead(200, { 'content-type': HTML });
				response.end(SPA_FALLBACK);
			});

			const { outcome, asked, output } = await verify(url, url, 'release');

			expect(outcome).toBeInstanceOf(DeployVerifyFailure);
			expect((outcome as Error).message).toContain('text/html');
			expect(asked).toEqual([`${url}/api/release`]);
			expect(output).toBe('');
		});
	});
});
