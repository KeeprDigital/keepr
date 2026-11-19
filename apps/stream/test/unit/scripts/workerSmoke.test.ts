import { Buffer } from 'node:buffer';
import { EventEmitter } from 'node:events';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	redactSmokeText,
	runWorkerSmoke,
	WorkerSmokeFailure,
} from '../../../scripts/worker-smoke/runner.mjs';

describe('the built Worker smoke runner', () => {
	const temporaryRoots: string[] = [];

	afterEach(async () => {
		vi.useRealTimers();
		vi.unstubAllEnvs();
		await Promise.all(
			temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
		);
	});

	async function builtRepository() {
		const repositoryRoot = await mkdtemp(join(tmpdir(), 'stream-keepr-worker-smoke-test-'));
		temporaryRoots.push(repositoryRoot);
		await mkdir(join(repositoryRoot, '.output/server'), { recursive: true });
		await mkdir(join(repositoryRoot, 'node_modules/.bin'), { recursive: true });
		await writeFile(join(repositoryRoot, '.output/server/wrangler.json'), '{}');
		await writeFile(join(repositoryRoot, 'node_modules/.bin/wrangler'), '');
		return repositoryRoot;
	}

	function exitedProcess(status: number) {
		const child = new EventEmitter() as EventEmitter & {
			stdout: PassThrough;
			stderr: PassThrough;
			pid: number;
			kill: ReturnType<typeof vi.fn>;
		};
		child.stdout = new PassThrough();
		child.stderr = new PassThrough();
		child.pid = 12345;
		child.kill = vi.fn();
		queueMicrotask(() => child.emit('exit', status, null));
		return child;
	}

	/** A spawn whose migration and Live Results seed exit 0, then starts `worker`. */
	function spawnAfterSetup(worker: () => unknown) {
		return vi
			.fn()
			.mockImplementationOnce(() => exitedProcess(0))
			.mockImplementationOnce(() => exitedProcess(0))
			.mockImplementationOnce(worker);
	}

	function livingProcess() {
		const child = new EventEmitter() as EventEmitter & {
			stdout: PassThrough;
			stderr: PassThrough;
			pid: number;
			kill: ReturnType<typeof vi.fn>;
		};
		child.stdout = new PassThrough();
		child.stderr = new PassThrough();
		child.pid = 12346;
		child.kill = vi.fn(() => {
			queueMicrotask(() => child.emit('exit', null, 'SIGTERM'));
			return true;
		});
		return child;
	}

	function stubbornProcess() {
		const child = livingProcess();
		child.kill = vi.fn((signal: NodeJS.Signals) => {
			if (signal === 'SIGKILL') queueMicrotask(() => child.emit('exit', null, signal));
			return true;
		});
		return child;
	}

	it('refuses a missing production artifact without starting any process', async () => {
		const repositoryRoot = await mkdtemp(join(tmpdir(), 'stream-keepr-worker-smoke-test-'));
		temporaryRoots.push(repositoryRoot);
		const spawnProcess = vi.fn();

		await expect(runWorkerSmoke({ repositoryRoot, spawnProcess })).rejects.toMatchObject({
			probe: 'precondition',
			failureClass: 'missing-artifact',
		});
		expect(spawnProcess).not.toHaveBeenCalled();
	});

	it('distinguishes a Worker that exits during startup from readiness timeout', async () => {
		const repositoryRoot = await builtRepository();
		const spawnProcess = spawnAfterSetup(() => exitedProcess(17));

		await expect(runWorkerSmoke({ repositoryRoot, spawnProcess })).rejects.toMatchObject({
			probe: 'startup',
			failureClass: 'process-exit',
			detail: { actual: 'exit 17' },
		});
		expect(spawnProcess).toHaveBeenCalledTimes(3);
	});

	it.each([
		{
			failing: 'migrations',
			exits: [3],
			failureClass: 'migration-exit',
		},
		{
			failing: 'the Live Results Event seed',
			exits: [0, 3],
			failureClass: 'seed-exit',
		},
	])('names failed $failing and starts no Worker', async ({ exits, failureClass }) => {
		const repositoryRoot = await builtRepository();
		const spawnProcess = vi.fn();
		for (const status of exits) spawnProcess.mockImplementationOnce(() => exitedProcess(status));

		await expect(runWorkerSmoke({ repositoryRoot, spawnProcess })).rejects.toMatchObject({
			probe: 'setup',
			failureClass,
		});
		expect(spawnProcess).toHaveBeenCalledTimes(exits.length);
	});

	it('restores both staged configuration files byte-for-byte after startup failure', async () => {
		const repositoryRoot = await builtRepository();
		const stagedEnv = join(repositoryRoot, '.output/server/.env');
		const stagedDevVars = join(repositoryRoot, '.output/server/.dev.vars');
		const originalEnv = Buffer.from('NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY=developer-value\n');
		const originalDevVars = Buffer.from('NUXT_ABLY_API_KEY=older-preview\n');
		vi.stubEnv('NUXT_DEVELOPER_CREDENTIAL', 'must-not-reach-wrangler');
		// Where the Worker's binding finds the Accounts Stand-in this command runs beside.
		vi.stubEnv('WRANGLER_REGISTRY_PATH', '/the/stand-in/registry');
		await writeFile(stagedEnv, originalEnv);
		await writeFile(stagedDevVars, originalDevVars);
		let generatedBody = '';
		const spawnProcess = vi
			.fn()
			.mockImplementationOnce((_command, _arguments, options) => {
				generatedBody = readFileSync(stagedEnv, 'utf8');
				expect(generatedBody).not.toContain('developer-value');
				expect(generatedBody).toContain('NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY=');
				expect(generatedBody).toContain('NUXT_MELEE_CREDENTIAL_ENCRYPTION_KEY=');
				// Nothing it generates is for signing in, or could stand in for it.
				expect(generatedBody).not.toMatch(/AUTH|BOOTSTRAP|BYPASS/);
				expect(existsSync(stagedDevVars)).toBe(false);
				expect(options.env).toMatchObject({
					NODE_ENV: 'production',
					WRANGLER_REGISTRY_PATH: '/the/stand-in/registry',
				});
				expect(options.env.NUXT_DEVELOPER_CREDENTIAL).toBeUndefined();
				expect(options.env.HOME).toBeUndefined();
				return exitedProcess(0);
			})
			.mockImplementationOnce(() => exitedProcess(0))
			.mockImplementationOnce(() => exitedProcess(17));

		await expect(runWorkerSmoke({ repositoryRoot, spawnProcess })).rejects.toMatchObject({
			probe: 'startup',
		});
		expect(generatedBody).not.toBe('');
		expect(await readFile(stagedEnv)).toEqual(originalEnv);
		expect(await readFile(stagedDevVars)).toEqual(originalDevVars);
	});

	it('terminates an interrupted migration and removes its temporary binding state', async () => {
		const repositoryRoot = await builtRepository();
		const stagedEnv = join(repositoryRoot, '.output/server/.env');
		const stagedDevVars = join(repositoryRoot, '.output/server/.dev.vars');
		const originalEnv = Buffer.from('original env\n');
		const originalDevVars = Buffer.from('original dev vars\n');
		await writeFile(stagedEnv, originalEnv);
		await writeFile(stagedDevVars, originalDevVars);
		// This run's own: the shared temporary directory also holds other runs' state.
		const temporaryRoot = await mkdtemp(join(tmpdir(), 'stream-keepr-worker-smoke-test-'));
		temporaryRoots.push(temporaryRoot);
		const migration = livingProcess();
		let bindingStateDuringMigration: string[] = [];

		await expect(
			runWorkerSmoke({
				repositoryRoot,
				temporaryRoot,
				spawnProcess: vi.fn(() => {
					bindingStateDuringMigration = readdirSync(temporaryRoot);
					return migration;
				}),
				hardTimeoutMs: 5,
			}),
		).rejects.toMatchObject({
			probe: 'runner',
			failureClass: 'hard-timeout',
		});

		expect(migration.kill).toHaveBeenCalledWith('SIGTERM');
		expect(await readFile(stagedEnv)).toEqual(originalEnv);
		expect(await readFile(stagedDevVars)).toEqual(originalDevVars);
		expect(bindingStateDuringMigration).toHaveLength(1);
		expect(await readdir(temporaryRoot)).toEqual([]);
	});

	it('terminates setup when the caller interrupts the smoke run', async () => {
		const repositoryRoot = await builtRepository();
		const migration = livingProcess();
		const interrupted = new AbortController();
		const spawnProcess = vi.fn(() => {
			queueMicrotask(() => interrupted.abort(new WorkerSmokeFailure('runner', 'interrupted')));
			return migration;
		});

		await expect(
			runWorkerSmoke({
				repositoryRoot,
				spawnProcess,
				signal: interrupted.signal,
			}),
		).rejects.toMatchObject({
			probe: 'runner',
			failureClass: 'interrupted',
		});
		expect(migration.kill).toHaveBeenCalledWith('SIGTERM');
	});

	it('names an API-boundary probe failure instead of accepting a reachable Worker', async () => {
		const repositoryRoot = await builtRepository();
		const worker = livingProcess();
		const spawnProcess = spawnAfterSetup(() => worker);
		const fetchRequest = vi
			.fn()
			.mockResolvedValueOnce(
				Response.json({
					serverTime: Date.now(),
				}),
			)
			.mockResolvedValueOnce(Response.json({ events: [] }));

		await expect(
			runWorkerSmoke({ repositoryRoot, spawnProcess, fetchRequest }),
		).rejects.toMatchObject({
			probe: 'api-boundary',
			failureClass: 'unexpected-status',
			detail: { expected: 401, actual: 200 },
		});
		expect(worker.kill).toHaveBeenCalled();
	});

	/** Who a request asks as, read from the cookie the Accounts Stand-in would read. */
	type Asked = {
		who: 'nobody' | 'outsider' | 'member' | 'administrator';
		method: string;
		path: string;
		crossSite: boolean;
	};

	/**
	 * A built Worker that holds every identity rule, as the smoke run's requests
	 * meet it, until `broken` answers one of them itself. Past the identity
	 * probes it fails the first write, so a run that got that far says so.
	 */
	function workerAnswering(
		repositoryRoot: string,
		broken: (asked: Asked) => Response | undefined = () => undefined,
	) {
		return vi.fn(async (input: string, init: RequestInit = {}) => {
			const url = new URL(input);
			const headers = new Headers(init.headers);
			if (url.pathname === '/api/time') return Response.json({ serverTime: Date.now() });

			const cookie = headers.get('cookie') ?? '';
			const persona = new URLSearchParams(cookie.replace(/^keepr-stand-in=/u, ''));
			const asked: Asked = {
				who:
					cookie === 'keepr-stand-in=signed-out'
						? 'nobody'
						: persona.get('stream') === 'none'
							? 'outsider'
							: persona.get('stream') === 'member'
								? 'member'
								: 'administrator',
				method: init.method ?? 'GET',
				path: url.pathname,
				crossSite: headers.get('sec-fetch-site') === 'cross-site',
			};
			const answer = broken(asked);
			if (answer) return answer;

			if (asked.path === '/')
				return new Response(readFileSync(join(repositoryRoot, '.output/server/.env'), 'utf8'));
			if (asked.who === 'nobody') return new Response(null, { status: 401 });
			if (asked.who === 'outsider' || asked.crossSite) return new Response(null, { status: 403 });
			if (asked.path.startsWith('/api/admin/') && asked.who !== 'administrator')
				return new Response(null, { status: 403 });
			if (asked.path === '/api/identity')
				return Response.json({
					user: { id: persona.get('user') },
					appRole: asked.who === 'member' ? 'member' : 'admin',
				});
			return asked.method === 'GET' ? Response.json([]) : new Response(null, { status: 500 });
		});
	}

	async function smokeAgainst(broken?: (asked: Asked) => Response | undefined) {
		const repositoryRoot = await builtRepository();
		return await runWorkerSmoke({
			repositoryRoot,
			spawnProcess: spawnAfterSetup(() => livingProcess()),
			fetchRequest: workerAnswering(repositoryRoot, broken),
		}).catch((error) => error);
	}

	const admitted = () => Response.json([]);
	const refused = (status: number) => () => new Response(null, { status });

	it('goes on to the product probes once the artifact holds every identity rule', async () => {
		expect(await smokeAgainst()).toMatchObject({ probe: 'event-persistence' });
	});

	// Each row is a built Worker that breaks one rule of who it admits (ADR-0141),
	// and the probe that must name it.
	it.each<[string, (asked: Asked) => boolean, () => Response, string]>([
		[
			'refuses a User whose Identity Proof is valid',
			({ who, path }) => who === 'administrator' && path === '/api/events',
			refused(401),
			'identity-proof-admitted',
		],
		[
			'answers another User than the Identity Proof names',
			({ path }) => path === '/api/identity',
			() => Response.json({ user: { id: 'somebody-else' }, appRole: 'admin' }),
			'identity-read',
		],
		[
			'admits a User with no App access',
			({ who, path }) => who === 'outsider' && path === '/api/events',
			admitted,
			'no-app-access',
		],
		[
			'admits a User with no App access on an admin route',
			({ who, path }) => who === 'outsider' && path.startsWith('/api/admin/'),
			admitted,
			'no-app-access-admin-route',
		],
		[
			'refuses a User whose App role is member',
			({ who, path }) => who === 'member' && path === '/api/events',
			refused(403),
			'member-admitted',
		],
		[
			'admits a User whose App role is not admin on an admin route',
			({ who, path }) => who === 'member' && path.startsWith('/api/admin/'),
			admitted,
			'admin-role-required',
		],
		[
			'refuses a Graphics Administrator an admin route',
			({ who, path }) => who === 'administrator' && path.startsWith('/api/admin/'),
			refused(403),
			'admin-role-admitted',
		],
		[
			"admits a write another site's page made",
			({ crossSite }) => crossSite,
			admitted,
			'cross-site-refusal',
		],
		[
			'grants a signed-out visitor a realtime token',
			({ who, path }) => who === 'nobody' && path === '/api/realtime/token',
			admitted,
			'realtime-grant-signed-out',
		],
		[
			'grants a User with no App access a realtime token',
			({ who, path }) => who === 'outsider' && path === '/api/realtime/token',
			admitted,
			'realtime-grant-no-app-access',
		],
		[
			"serves a page that does not name its Environment's Keepr Accounts",
			({ path }) => path === '/',
			() => new Response('<html>https://accounts.keepr.digital</html>'),
			'shell-keepr-accounts-origin',
		],
	])('refuses a Worker that %s', async (_case, breaks, answer, probe) => {
		const outcome = await smokeAgainst((asked) => (breaks(asked) ? answer() : undefined));

		expect(outcome).toMatchObject({ probe });
	});

	it('escalates cleanup to SIGKILL and waits for the child exit', async () => {
		vi.useFakeTimers({
			toFake: ['setTimeout', 'clearTimeout'],
		});
		const repositoryRoot = await builtRepository();
		const worker = stubbornProcess();
		const spawnProcess = spawnAfterSetup(() => worker);
		const fetchRequest = vi
			.fn()
			.mockResolvedValueOnce(
				Response.json({
					serverTime: Date.now(),
				}),
			)
			.mockResolvedValueOnce(Response.json({ events: [] }));
		const outcome = runWorkerSmoke({ repositoryRoot, spawnProcess, fetchRequest }).catch(
			(error) => error,
		);

		// Bounded by real time, not event-loop turns: the runner does real
		// filesystem work first, and a slow CI machine needs more turns than a
		// fixed count allowed. `vi.waitFor` keeps real timers under fake ones.
		await vi.waitFor(() => expect(worker.kill).toHaveBeenCalledWith('SIGTERM'));
		await vi.advanceTimersByTimeAsync(2_000);

		expect(await outcome).toMatchObject({
			probe: 'api-boundary',
			failureClass: 'unexpected-status',
		});
		expect(worker.kill.mock.calls.map(([signal]) => signal)).toEqual(['SIGTERM', 'SIGKILL']);
	});

	it('reports readiness timeout separately while the Worker is still running', async () => {
		const repositoryRoot = await builtRepository();
		const worker = livingProcess();
		const spawnProcess = spawnAfterSetup(() => worker);

		await expect(
			runWorkerSmoke({
				repositoryRoot,
				spawnProcess,
				fetchRequest: vi.fn().mockRejectedValue(new Error('not ready')),
				readinessTimeoutMs: 5,
			}),
		).rejects.toMatchObject({
			probe: 'readiness',
			failureClass: 'timeout',
		});
		expect(worker.kill).toHaveBeenCalled();
	});

	it('redacts generated values, digests, resource identities, and full URLs', () => {
		const secret = 'generated-secret-value';
		const digest = 'a'.repeat(64);
		const text = [
			secret,
			digest,
			'/api/events/42/graphics-assets/550e8400-e29b-41d4-a716-446655440000',
			'{"eventId":42,"assetId":"asset-in-a-log"}',
			'https://127.0.0.1:8787/api/events/42?credential=secret',
		].join(' ');
		const redacted = redactSmokeText(text, [secret]);

		expect(redacted).not.toContain(secret);
		expect(redacted).not.toContain(digest);
		expect(redacted).not.toContain('550e8400-e29b-41d4-a716-446655440000');
		expect(redacted).not.toContain('asset-in-a-log');
		expect(redacted).not.toContain('https://127.0.0.1:8787');
		expect(redacted).toContain('[redacted]');
	});
});
