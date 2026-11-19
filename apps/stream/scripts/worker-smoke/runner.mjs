import { Buffer } from 'node:buffer';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { standInCookie } from '@keepr/accounts-stand-in/cookie';
import { CLOSE_REFUSED } from '@keepr/realtime/protocol';
import { LIVE_RESULTS_CRON } from '../../server/utils/cronSchedules.ts';
import {
	eventRealtimeChannel,
	screenRealtimeChannel,
} from '../../shared/utils/realtimeChannels.ts';
import { DeployVerifyFailure, verifyDeployment } from '@keepr/tooling/scripts/deploy/verify.mjs';

const PIXEL_PNG = Uint8Array.from(
	Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
		'base64',
	),
);
const PIXEL_JPEG = Uint8Array.from(
	Buffer.from(
		'/9j/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJtAEx7/2Q==',
		'base64',
	),
);

/** An Event with Live Results on and no Rounds, so its tick idles and asks Melee nothing. */
const LIVE_RESULTS_EVENT_ID = 900_001;
const LIVE_RESULTS_TICK_TIMEOUT_MS = 10_000;
/** How long a realtime socket may take to answer what it was asked, or to close. */
const REALTIME_SOCKET_TIMEOUT_MS = 10_000;
const LIVE_RESULTS_EVENT_SQL =
	'INSERT INTO events (id, name, game, feature_match_orientation, melee_enabled, melee_live_results_enabled) ' +
	`VALUES (${LIVE_RESULTS_EVENT_ID}, 'Built Worker smoke Live Results', 'mtg', 'horizontal', 1, 1)`;

export class WorkerSmokeFailure extends Error {
	constructor(probe, failureClass, detail = {}) {
		super(`worker:smoke ${probe} failed (${failureClass})`);
		this.name = 'WorkerSmokeFailure';
		this.probe = probe;
		this.failureClass = failureClass;
		this.detail = detail;
	}
}

export function redactSmokeText(value, secrets = []) {
	let redacted = String(value);
	for (const secret of [...secrets].filter(
		(secret) => typeof secret === 'string' && secret.length > 0,
	))
		redacted = redacted.replaceAll(secret, '[redacted]');
	return redacted
		.replace(/https?:\/\/[^\s"'`]+/giu, '[redacted-url]')
		.replace(/\b[a-f0-9]{64}\b/giu, '[redacted-digest]')
		.replace(
			/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu,
			'[redacted-id]',
		)
		.replace(
			/("(?:eventId|assetId|revisionId|operationId|screenId|userId|id)"\s*:\s*)(?:"[^"]+"|\d+)/giu,
			'$1"[redacted-id]"',
		)
		.replace(
			/\/(events|screens|graphics-assets|ingestion-operations|revisions)\/[^/\s?]+/giu,
			'/$1/[redacted-id]',
		);
}

export function formatWorkerSmokeFailure(error) {
	const detail = error?.detail ?? {};
	const lines = [
		`worker:smoke: ${error?.probe ?? 'runner'} failed (${error?.failureClass ?? 'unexpected-error'})`,
	];
	if (detail.expected !== undefined) lines.push(`  expected: ${detail.expected}`);
	if (detail.actual !== undefined) lines.push(`  actual: ${detail.actual}`);
	if (error?.workerLogTail) {
		lines.push('  Worker log tail:');
		for (const line of error.workerLogTail.split('\n')) lines.push(`    ${line}`);
	}
	return `${lines.join('\n')}\n`;
}

/**
 * @param {{
 *   repositoryRoot: string,
 *   spawnProcess?: Function,
 *   fetchRequest?: Function,
 *   openSocket?: (url: string, headers: Record<string, string>) => WebSocket,
 *   readinessTimeoutMs?: number,
 *   hardTimeoutMs?: number,
 *   temporaryRoot?: string,
 *   signal?: AbortSignal,
 * }} options `temporaryRoot` is where the run's local binding state is created
 *   and removed; the system temporary directory unless a caller owns another.
 */
export async function runWorkerSmoke({
	repositoryRoot,
	spawnProcess = spawn,
	fetchRequest = fetch,
	// Node's `WebSocket` takes a handshake's headers, as a browser's cannot.
	openSocket = (url, headers) => new WebSocket(url, { headers }),
	readinessTimeoutMs = 30_000,
	hardTimeoutMs = 300_000,
	temporaryRoot = tmpdir(),
	signal,
}) {
	const configPath = join(repositoryRoot, '.output/server/wrangler.json');
	if (!existsSync(configPath)) {
		throw new WorkerSmokeFailure('precondition', 'missing-artifact', {
			expected: '.output/server/wrangler.json from pnpm build',
			actual: 'missing',
		});
	}

	const wranglerPath = join(repositoryRoot, 'node_modules/.bin/wrangler');
	const stagedEnvPath = join(repositoryRoot, '.output/server/.env');
	const stagedDevVarsPath = join(repositoryRoot, '.output/server/.dev.vars');
	const generated = generatedConfiguration();
	const sensitiveValues = [...generated.secrets];
	const workerLog = new BoundedLogTail();
	const timeout = new AbortController();
	const hardTimeout = setTimeout(
		() =>
			timeout.abort(
				new WorkerSmokeFailure('runner', 'hard-timeout', {
					expected: `completion within ${hardTimeoutMs}ms`,
					actual: 'hard timeout reached',
				}),
			),
		hardTimeoutMs,
	);
	const smokeSignal = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
	const startedAt = Date.now();
	let persistencePath;
	let activeChild;
	let activeChildExit;
	let stagedConfiguration;
	try {
		stagedConfiguration = await relocateConfigurations([stagedEnvPath, stagedDevVarsPath]);
		await writeFile(stagedEnvPath, generated.body, { mode: 0o600 });
		await rm(stagedDevVarsPath, { force: true });
		persistencePath = await mkdtemp(join(temporaryRoot, 'stream-keepr-worker-smoke-'));
		const childProcessOptions = {
			cwd: repositoryRoot,
			env: hermeticChildEnvironment(),
			stdio: ['ignore', 'pipe', 'pipe'],
		};
		const runSetup = async (arguments_) => {
			const setup = spawnProcess(
				wranglerPath,
				['d1', ...arguments_, '--local', '--config', configPath, '--persist-to', persistencePath],
				{ ...childProcessOptions, detached: true },
			);
			activeChild = setup;
			captureChildOutput(setup, workerLog);
			activeChildExit = childExit(setup, 'setup');
			const setupExit = await abortable(activeChildExit, smokeSignal);
			if (setupExit.status !== 0) {
				throw new WorkerSmokeFailure(
					'setup',
					arguments_[0] === 'migrations' ? 'migration-exit' : 'seed-exit',
					{
						expected: 'exit 0',
						actual: exitDescription(setupExit),
					},
				);
			}
			activeChild = undefined;
			activeChildExit = undefined;
		};
		await runSetup(['migrations', 'apply', 'DB']);
		// Melee Sync can be switched on only after Melee.gg accepts the
		// credentials, so the Live Results Event is written straight to D1.
		await runSetup(['execute', 'DB', '--command', LIVE_RESULTS_EVENT_SQL]);

		const startWorker = async () => {
			const port = await availableLoopbackPort();
			const arguments_ = [
				'dev',
				'--local',
				'--config',
				configPath,
				'--persist-to',
				persistencePath,
				'--ip',
				'127.0.0.1',
				'--port',
				String(port),
				// Exposes `/__scheduled`, the Worker's scheduled handler.
				'--test-scheduled',
			];
			activeChild = spawnProcess(wranglerPath, arguments_, {
				...childProcessOptions,
				detached: true,
			});
			captureChildOutput(activeChild, workerLog);
			activeChildExit = childExit(activeChild, 'startup');
			const origin = `http://127.0.0.1:${port}`;
			await waitUntilReady({
				origin,
				fetchRequest,
				exit: activeChildExit,
				readinessTimeoutMs,
				signal: smokeSignal,
			});
			return origin;
		};
		// One run of the artifact: nothing it could be restarted under changes
		// who it admits. The Accounts Stand-in this command runs beside answers
		// its `KEEPR_ACCOUNTS` binding, as Keepr Accounts does when deployed.
		const origin = await startWorker();
		await runProductProbes({
			origin,
			fetchRequest,
			openSocket,
			generated,
			sensitiveValues,
			signal: smokeSignal,
		});
		return { elapsedMs: Date.now() - startedAt };
	} catch (error) {
		const failure =
			error instanceof WorkerSmokeFailure
				? error
				: new WorkerSmokeFailure('runner', 'unexpected-error', {
						expected: 'completed smoke run',
						actual: error?.name ?? 'unknown failure',
					});
		failure.workerLogTail = redactSmokeText(workerLog.text(), sensitiveValues);
		throw failure;
	} finally {
		clearTimeout(hardTimeout);
		try {
			await terminateChild(activeChild, activeChildExit);
		} finally {
			if (stagedConfiguration) await Promise.all(stagedConfiguration.map(restoreConfiguration));
			if (persistencePath) await rm(persistencePath, { recursive: true, force: true });
		}
	}
}

function generatedConfiguration() {
	// Deliberately omit Ably and external Melee credentials. Publication is
	// disabled without Ably, and the Melee persistence probe saves disabled
	// configuration, so this process has neither authority nor reason to leave
	// loopback.
	const base64Key = () => randomBytes(32).toString('base64');
	// Nothing here is for sign-in: who a request belongs to is the Accounts
	// Stand-in's answer. The Keepr Accounts origin is a var the Environment sets
	// (`wrangler.jsonc`), named here as a host of this run's own so the shell
	// probe shows the artifact reads it at runtime.
	const entries = {
		NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY: base64Key(),
		NUXT_MELEE_CREDENTIAL_ENCRYPTION_KEY: base64Key(),
		NUXT_MELEE_CREDENTIAL_KEY_VERSION: '1',
		NUXT_PUBLIC_KEEPR_ACCOUNTS_ORIGIN: `https://accounts.${randomBytes(6).toString('hex')}.invalid`,
	};
	const PUBLIC = ['NUXT_MELEE_CREDENTIAL_KEY_VERSION', 'NUXT_PUBLIC_KEEPR_ACCOUNTS_ORIGIN'];
	return {
		entries,
		secrets: Object.entries(entries)
			.filter(([name]) => !PUBLIC.includes(name))
			.map(([, entry]) => entry),
		body: `${Object.entries(entries)
			.map(([name, entry]) => `${name}=${entry}`)
			.join('\n')}\n`,
	};
}

function hermeticChildEnvironment() {
	const allowedNames = [
		'PATH',
		'TMPDIR',
		'TEMP',
		'TMP',
		'SystemRoot',
		'WINDIR',
		'ComSpec',
		'PATHEXT',
		// Where the Worker's `KEEPR_ACCOUNTS` binding finds the Accounts Stand-in
		// this command runs beside (`keepr-accounts-stand-in`).
		'WRANGLER_REGISTRY_PATH',
	];
	return Object.fromEntries([
		...allowedNames
			.filter((name) => process.env[name] !== undefined)
			.map((name) => [name, process.env[name]]),
		['NODE_ENV', 'production'],
	]);
}

async function relocateConfigurations(paths) {
	const relocated = [];
	try {
		for (const path of paths) relocated.push(await relocateConfiguration(path));
		return relocated;
	} catch (error) {
		await Promise.all(relocated.map(restoreConfiguration));
		throw error;
	}
}

async function relocateConfiguration(path) {
	const backupPath = `${path}.worker-smoke-backup-${randomUUID()}`;
	try {
		await rename(path, backupPath);
		return { path, backupPath };
	} catch (error) {
		if (error?.code === 'ENOENT') return { path, backupPath: null };
		throw error;
	}
}

async function restoreConfiguration({ path, backupPath }) {
	await rm(path, { force: true });
	if (backupPath) await rename(backupPath, path);
}

function childExit(child, probe) {
	return new Promise((resolve, reject) => {
		child.once('error', (error) =>
			reject(
				new WorkerSmokeFailure(probe, 'spawn-error', {
					expected: 'child process started',
					actual: error?.code ?? 'spawn failed',
				}),
			),
		);
		child.once('exit', (status, signal) => resolve({ status, signal }));
	});
}

function exitDescription({ status, signal }) {
	return status === null ? `signal ${signal ?? 'unknown'}` : `exit ${status}`;
}

async function availableLoopbackPort() {
	const server = createServer();
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	const address = server.address();
	await new Promise((resolve, reject) =>
		server.close((error) => (error ? reject(error) : resolve())),
	);
	if (!address || typeof address === 'string')
		throw new WorkerSmokeFailure('setup', 'loopback-port-unavailable');
	return address.port;
}

async function waitUntilReady({ origin, fetchRequest, exit, readinessTimeoutMs, signal }) {
	const deadline = Date.now() + readinessTimeoutMs;
	while (Date.now() < deadline) {
		const outcome = await Promise.race([
			fetchRequest(`${origin}/api/time`, { signal })
				.then(async (response) => ({
					kind: 'response',
					response,
					body: await response.json().catch(() => null),
				}))
				.catch(() => ({ kind: 'unreachable' })),
			exit.then((result) => ({ kind: 'exit', result })),
		]);
		if (outcome.kind === 'exit') {
			throw new WorkerSmokeFailure('startup', 'process-exit', {
				expected: 'running Worker',
				actual: exitDescription(outcome.result),
			});
		}
		if (
			outcome.kind === 'response' &&
			outcome.response.status === 200 &&
			typeof outcome.body?.serverTime === 'number'
		) {
			return;
		}
		await abortable(new Promise((resolve) => setTimeout(resolve, 50)), signal);
	}
	throw new WorkerSmokeFailure('readiness', 'timeout', {
		expected: 'GET /api/time status 200',
		actual: `no successful response within ${readinessTimeoutMs}ms`,
	});
}

async function abortable(promise, signal) {
	if (!signal) return await promise;
	if (signal.aborted) throw signal.reason;
	return await new Promise((resolve, reject) => {
		const aborted = () => reject(signal.reason);
		signal.addEventListener('abort', aborted, { once: true });
		promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
	});
}

async function terminateChild(child, exit) {
	if (!child) return;
	const alreadyExited = exit
		? await Promise.race([
				exit.then(
					() => true,
					() => true,
				),
				Promise.resolve(false),
			])
		: false;
	if (alreadyExited) return;
	signalChild(child, 'SIGTERM');
	const stopped = exit
		? await Promise.race([
				exit.then(
					() => true,
					() => true,
				),
				new Promise((resolve) => setTimeout(resolve, 2_000, false)),
			])
		: false;
	if (!stopped) signalChild(child, 'SIGKILL');
	if (!stopped && exit) {
		const killed = await Promise.race([
			exit.then(
				() => true,
				() => true,
			),
			new Promise((resolve) => setTimeout(resolve, 2_000, false)),
		]);
		if (!killed) {
			throw new WorkerSmokeFailure('cleanup', 'child-exit-timeout', {
				expected: 'child exited after SIGKILL',
				actual: 'still running after 2000ms',
			});
		}
	}
}

function signalChild(child, signal) {
	if (child.spawnfile && child.pid) {
		try {
			process.kill(-child.pid, signal);
			return;
		} catch {
			// A child that left between the check and signal needs no fallback;
			// child.kill is harmless there and also covers non-POSIX platforms.
		}
	}
	child.kill(signal);
}

class BoundedLogTail {
	#lines = [];

	append(chunk) {
		this.#lines.push(...String(chunk).split(/\r?\n/u).filter(Boolean));
		this.#lines = this.#lines.slice(-40);
		while (this.text().length > 6_000) this.#lines.shift();
	}

	text() {
		return this.#lines.join('\n');
	}
}

function captureChildOutput(child, tail) {
	child.stdout?.on('data', (chunk) => tail.append(chunk));
	child.stderr?.on('data', (chunk) => tail.append(chunk));
}

/** The admin route the role probes ask: a read of settings, with nothing to seed. */
const ADMIN_ROUTE = '/api/admin/graphics-assets/capacity';

/**
 * Who the artifact admits, asked of it as the Accounts Stand-in's cookie names
 * each caller (ADR-0141). Every refusal here is the built Worker's own: the
 * stand-in only says who is asking, as Keepr Accounts would.
 */
async function expectIdentityBoundary({ origin, fetchRequest, signal }) {
	const run = randomBytes(4).toString('hex');
	const operator = standInCookie({ user: `worker-smoke-operator-${run}` });
	const member = standInCookie({
		user: `worker-smoke-member-${run}`,
		apps: { stream: 'member' },
	});
	const outsider = standInCookie({
		user: `worker-smoke-outsider-${run}`,
		apps: { stream: null },
	});
	const ask = (probe, expected, path, cookie, init = {}) =>
		expectStatus({
			probe,
			expected,
			origin,
			path,
			fetchRequest,
			signal,
			init: { ...init, headers: { ...init.headers, cookie } },
		});

	// No Identity Proof: Keepr Accounts answers a signed-out visitor with none.
	await ask('api-boundary', 401, '/api/events', standInCookie('signed-out'));
	// A valid Identity Proof is admitted, and names who the request belongs to.
	await ask('identity-proof-admitted', 200, '/api/events', operator);
	const identity = await responseJson(
		await ask('identity-read', 200, '/api/identity', operator),
		'identity-read',
	);
	if (identity?.user?.id !== `worker-smoke-operator-${run}` || identity?.appRole !== 'admin')
		throwShapeFailure('identity-read', 'the User and App role the Identity Proof names');
	// A User with no App access to Stream Keepr is refused, an admin route included.
	await ask('no-app-access', 403, '/api/events', outsider);
	await ask('no-app-access-admin-route', 403, ADMIN_ROUTE, outsider);
	// An admin route refuses a User whose App role is not `admin`, and admits one whose is.
	await ask('member-admitted', 200, '/api/events', member);
	await ask('admin-role-required', 403, ADMIN_ROUTE, member);
	await ask('admin-role-admitted', 200, ADMIN_ROUTE, operator);
	// A Session cookie does not carry a write another site's page made.
	await ask('cross-site-refusal', 403, '/api/events', operator, {
		...jsonRequest({ name: 'Cross-site Event', game: 'mtg' }, { 'sec-fetch-site': 'cross-site' }),
	});
	// The realtime grant is outside the boundary and asks for itself.
	await ask(
		'realtime-grant-signed-out',
		401,
		'/api/realtime/token?eventId=1',
		standInCookie('signed-out'),
	);
	await ask('realtime-grant-no-app-access', 403, '/api/realtime/token?eventId=1', outsider);

	return operator;
}

/**
 * The page a signed-out visitor is sent from names this Environment's Keepr
 * Accounts: the artifact reads the origin at runtime, from the var each
 * Environment sets, so Staging sends nobody to Production's sign-in.
 */
async function expectShellNamesKeeprAccounts({ origin, fetchRequest, generated, signal }) {
	const shell = await expectStatus({
		probe: 'shell-keepr-accounts-origin',
		expected: 200,
		origin,
		path: '/',
		fetchRequest,
		signal,
	});
	if (!(await shell.text()).includes(generated.entries.NUXT_PUBLIC_KEEPR_ACCOUNTS_ORIGIN))
		throwShapeFailure('shell-keepr-accounts-origin', "the Environment's Keepr Accounts origin");
}

async function runProductProbes({
	origin,
	fetchRequest,
	openSocket,
	generated,
	sensitiveValues,
	signal,
}) {
	const cookie = await expectIdentityBoundary({ origin, fetchRequest, signal });
	await expectShellNamesKeeprAccounts({ origin, fetchRequest, generated, signal });

	const event = await expectJson({
		probe: 'event-persistence',
		expected: 201,
		origin,
		path: '/api/events',
		fetchRequest,
		signal,
		init: jsonRequest(
			{
				name: 'Built Worker smoke Event',
				game: 'mtg',
				featureMatchOrientation: 'horizontal',
			},
			{ cookie },
		),
	});
	if (!Number.isInteger(event?.id))
		throwShapeFailure('event-persistence', 'numeric Event identity');

	const meleeClientSecret = randomBytes(24).toString('base64url');
	sensitiveValues.push(meleeClientSecret);
	const melee = await expectJson({
		probe: 'melee-configuration',
		expected: 200,
		origin,
		path: `/api/events/${event.id}/melee-config`,
		fetchRequest,
		signal,
		init: {
			...jsonRequest(
				{
					meleeEnabled: false,
					meleeEventId: 'worker-smoke-event',
					meleeClientId: 'worker-smoke-client',
					meleeClientSecret,
				},
				{ cookie },
			),
			method: 'PUT',
		},
	});
	assertMeleeRedaction(melee, meleeClientSecret, 'melee-configuration');
	const reread = await expectJson({
		probe: 'melee-configuration-read',
		expected: 200,
		origin,
		path: `/api/events/${event.id}`,
		fetchRequest,
		signal,
		init: {
			headers: { cookie },
		},
	});
	assertMeleeRedaction(reread, meleeClientSecret, 'melee-configuration-read');

	await publishStillImage({
		format: 'png',
		bytes: PIXEL_PNG,
		mime: 'image/png',
		fileName: 'worker-smoke.png',
		eventId: event.id,
		origin,
		cookie,
		fetchRequest,
		signal,
	});
	const jpeg = await publishStillImage({
		format: 'jpeg',
		bytes: PIXEL_JPEG,
		mime: 'image/jpeg',
		fileName: 'worker-smoke.jpg',
		eventId: event.id,
		origin,
		cookie,
		fetchRequest,
		signal,
	});
	await verifyJpegDelivery({
		...jpeg,
		bytes: PIXEL_JPEG,
		origin,
		cookie,
		fetchRequest,
		signal,
	});

	await expectRealtimeAdmission({
		origin,
		cookie,
		eventId: event.id,
		fetchRequest,
		openSocket,
		sensitiveValues,
		signal,
	});

	await expectDeployVerifyPasses({ origin, fetchRequest, signal });
	await expectLiveResultsTickOnlyOnCron({ origin, cookie, fetchRequest, signal });
}

/**
 * One realtime socket to the artifact, opened as given: what the Event's
 * object answers each channel it asks to attach, or the code it was closed
 * with first. A refused socket opens too, so opening says nothing.
 */
async function realtimeSocket({ probe, origin, query, headers, attach, openSocket, signal }) {
	const address = `${origin.replace(/^http/u, 'ws')}/realtime/socket?${new URLSearchParams(query)}`;
	let socket;
	try {
		socket = openSocket(address, headers);
	} catch {
		throw new WorkerSmokeFailure(probe, 'socket-failed', {
			expected: 'a socket',
			actual: 'the socket could not be opened',
		});
	}
	const frames = [];
	let settleClosed;
	const whenClosed = new Promise((resolve) => {
		settleClosed = resolve;
	});
	const answered = new Promise((resolve) => {
		socket.addEventListener('open', () =>
			socket.send(JSON.stringify({ t: 'hello', attach: attach.map((channel) => ({ channel })) })),
		);
		socket.addEventListener('message', ({ data }) => {
			try {
				const { t, channel, what } = JSON.parse(data);
				frames.push(t === 'refused' ? `${what} refused ${channel}` : `${t} ${channel}`);
			} catch {
				frames.push('unreadable');
			}
			if (frames.length === attach.length) resolve({ frames });
		});
		socket.addEventListener('close', ({ code }) => {
			settleClosed(code);
			resolve({ closed: code });
		});
	});
	let timer;
	const timedOut = new Promise((_resolve, reject) => {
		timer = setTimeout(
			() =>
				reject(
					new WorkerSmokeFailure(probe, 'socket-timeout', {
						expected: `an answer within ${REALTIME_SOCKET_TIMEOUT_MS}ms`,
						actual: frames.length > 0 ? frames.join(', ') : 'no answer',
					}),
				),
			REALTIME_SOCKET_TIMEOUT_MS,
		);
	});
	try {
		return {
			...(await abortable(Promise.race([answered, timedOut]), signal)),
			socket,
			whenClosed,
		};
	} catch (error) {
		socket.close();
		throw error;
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Who the artifact lets onto a realtime socket (ADR-0137, ADR-0142), through
 * the built Worker's own entry and hand-off: a Session from the app's own
 * origin, and a Screen Output for a Realtime Ticket, once. The artifact has no
 * route that publishes for a test, so what a socket may hear is read from what
 * the Event's object answers an attach.
 */
async function expectRealtimeAdmission({
	origin,
	cookie,
	eventId,
	fetchRequest,
	openSocket,
	sensitiveValues,
	signal,
}) {
	const opened = [];
	const open = async (probe, query, headers, attach = []) => {
		const answer = await realtimeSocket({
			probe,
			origin,
			query,
			headers,
			attach,
			openSocket,
			signal,
		});
		opened.push(answer.socket);
		return answer;
	};
	const expectAnswers = async (probe, query, headers, expected) => {
		const answer = await open(
			probe,
			query,
			headers,
			expected.map((frame) => frame.split(' ').at(-1)),
		);
		const actual = answer.frames ? answer.frames.toSorted().join(', ') : `closed ${answer.closed}`;
		if (actual !== expected.toSorted().join(', '))
			throw new WorkerSmokeFailure(probe, 'unexpected-socket-answer', {
				expected: expected.toSorted().join(', '),
				actual,
			});
		return answer;
	};
	const expectRefused = async (probe, query, headers) => {
		// Asked to attach, so a socket wrongly let in answers, and is not waited out.
		const answer = await open(probe, query, headers, [eventRealtimeChannel(eventId)]);
		if (answer.closed !== CLOSE_REFUSED)
			throw new WorkerSmokeFailure(probe, 'socket-not-refused', {
				expected: `closed ${CLOSE_REFUSED}`,
				actual: answer.frames ? answer.frames.join(', ') : `closed ${answer.closed}`,
			});
	};
	const request = (probe, expected, path, init) =>
		expectJson({ probe, expected, origin, path, fetchRequest, signal, init });

	try {
		// A Session, from the app's own page: its Event's channel is its to hear.
		await expectAnswers('realtime-session-admitted', { eventId }, { cookie, origin }, [
			`attached ${eventRealtimeChannel(eventId)}`,
		]);
		// The same Session's cookie on a socket another site's page opened.
		await expectRefused(
			'realtime-session-cross-origin',
			{ eventId },
			{ cookie, origin: 'https://another-site.invalid' },
		);
		await expectRefused(
			'realtime-signed-out',
			{ eventId },
			{ cookie: standInCookie('signed-out'), origin },
		);

		const screen = await request(
			'realtime-screen',
			201,
			`/api/events/${eventId}/screens`,
			jsonRequest({ name: 'Built Worker smoke Screen', slug: 'worker-smoke' }, { cookie }),
		);
		const capabilityPath = `/api/events/${eventId}/screens/${screen?.id}/asset-capability`;
		const { assetCapability } = await request('realtime-capability', 200, capabilityPath, {
			headers: { cookie },
		});
		sensitiveValues.push(assetCapability);
		const ticketPath = `/api/realtime/ticket?eventId=${eventId}`;
		// A Session is no capability: an Operator who presents none is given no ticket.
		await expectStatus({
			probe: 'realtime-ticket-needs-capability',
			expected: 401,
			origin,
			path: ticketPath,
			fetchRequest,
			signal,
			init: { method: 'POST', headers: { cookie } },
		});
		const { ticket } = await request('realtime-ticket', 200, ticketPath, {
			method: 'POST',
			headers: { authorization: `Bearer ${assetCapability}` },
		});
		if (typeof ticket !== 'string') throwShapeFailure('realtime-ticket', 'a Realtime Ticket');
		sensitiveValues.push(ticket);

		// A Screen Output: its own Screen's channel, and nothing of its Event's.
		const output = await expectAnswers('realtime-output-admitted', { eventId, ticket }, {}, [
			`attached ${screenRealtimeChannel(eventId, screen.id)}`,
			`attach refused ${eventRealtimeChannel(eventId)}`,
		]);
		// One ticket, one socket.
		await expectRefused('realtime-ticket-spent', { eventId, ticket }, {});

		// Regenerating the capability closes the socket it admitted.
		await request('realtime-capability-regenerated', 200, capabilityPath, {
			method: 'POST',
			headers: { cookie },
		});
		let timer;
		const closedWith = await abortable(
			Promise.race([
				output.whenClosed,
				new Promise((resolve) => {
					timer = setTimeout(() => resolve('still open'), REALTIME_SOCKET_TIMEOUT_MS);
				}),
			]),
			signal,
		).finally(() => clearTimeout(timer));
		if (closedWith !== CLOSE_REFUSED)
			throw new WorkerSmokeFailure('realtime-output-disconnected', 'socket-not-closed', {
				expected: `closed ${CLOSE_REFUSED}`,
				actual: closedWith === 'still open' ? closedWith : `closed ${closedWith}`,
			});
	} finally {
		for (const socket of opened) socket.close();
	}
}

function checkoutIdentity() {
	const { version } = JSON.parse(
		readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
	);
	let commit;
	try {
		commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
	} catch {
		commit = 'unknown';
	}
	return { app: 'stream', version, commit };
}

/**
 * The production bundle must pass the probes `pnpm run deploy` gates on, so a
 * stricter `deploy:verify` can never first fail on deploy day (#617): its
 * liveness, and its release identity, each reached without a session (ADR-0119).
 */
async function expectDeployVerifyPasses({ origin, fetchRequest, signal }) {
	for (const [expected, probe] of [
		[undefined, 'GET /api/time'],
		[checkoutIdentity(), 'GET /api/release naming this checkout'],
	]) {
		try {
			await verifyDeployment({
				baseUrl: origin,
				...(expected ? { expected } : {}),
				fetchRequest,
				attempts: 1,
				signal,
			});
		} catch (error) {
			if (!(error instanceof DeployVerifyFailure)) throw error;
			throw new WorkerSmokeFailure('deploy-verify', 'probe-rejected', {
				expected: `${probe} accepted by the deploy's verify (@keepr/tooling)`,
				actual: redactSmokeText(error.message),
			});
		}
	}
}

/**
 * The built Worker ticks Live Results only when its minute cron fires: the
 * in-process schedule a local dev server runs never starts in it (#887), and
 * the scheduled handler reaches the tick.
 */
async function expectLiveResultsTickOnlyOnCron({ origin, cookie, fetchRequest, signal }) {
	const lastCheckedAt = async (probe) => {
		const status = await expectJson({
			probe,
			expected: 200,
			origin,
			path: `/api/events/${LIVE_RESULTS_EVENT_ID}/melee/live-results`,
			fetchRequest,
			signal,
			init: {
				headers: { cookie },
			},
		});
		return status?.lastCheckedAt ?? null;
	};

	const beforeCron = await lastCheckedAt('live-results-before-cron');
	if (beforeCron !== null) {
		throw new WorkerSmokeFailure('live-results-before-cron', 'unexpected-tick', {
			expected: 'no Live Results tick before the cron fires',
			actual: `checked at ${beforeCron}`,
		});
	}
	await expectStatus({
		probe: 'live-results-cron',
		expected: 200,
		origin,
		path: `/__scheduled?${new URLSearchParams({ cron: LIVE_RESULTS_CRON })}`,
		fetchRequest,
		signal,
	});
	// `/__scheduled` answers once the handler returns; the tick runs on in its
	// `waitUntil`, so the check is awaited rather than read once.
	const deadline = Date.now() + LIVE_RESULTS_TICK_TIMEOUT_MS;
	while ((await lastCheckedAt('live-results-after-cron')) === null) {
		if (Date.now() > deadline)
			throwShapeFailure('live-results-after-cron', 'a Live Results tick on the minute cron');
		await abortable(new Promise((resolve) => setTimeout(resolve, 100)), signal);
	}
}

function jsonRequest(body, headers = {}) {
	return {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...headers },
		body: JSON.stringify(body),
	};
}

async function expectStatus({ probe, expected, origin, path, fetchRequest, signal, init = {} }) {
	let response;
	try {
		response = await fetchRequest(`${origin}${path}`, { redirect: 'manual', ...init, signal });
	} catch {
		if (signal?.aborted) throw signal.reason;
		throw new WorkerSmokeFailure(probe, 'request-failed', {
			expected: `status ${expected}`,
			actual: 'request failed',
		});
	}
	if (response.status !== expected) {
		throw new WorkerSmokeFailure(probe, 'unexpected-status', {
			expected,
			actual: response.status,
		});
	}
	return response;
}

async function expectJson(options) {
	const response = await expectStatus(options);
	return await responseJson(response, options.probe);
}

async function responseJson(response, probe) {
	try {
		return await response.json();
	} catch {
		throw new WorkerSmokeFailure(probe, 'invalid-json', {
			expected: 'JSON response',
			actual: 'unparseable body',
		});
	}
}

function throwShapeFailure(probe, expected) {
	throw new WorkerSmokeFailure(probe, 'unexpected-body', {
		expected,
		actual: 'response shape did not match',
	});
}

function assertMeleeRedaction(value, secret, probe) {
	if (value?.meleeConfigured !== true) throwShapeFailure(probe, 'persisted Melee configuration');
	if (Object.hasOwn(value, 'meleeClientSecret') || JSON.stringify(value).includes(secret)) {
		throw new WorkerSmokeFailure(probe, 'secret-exposed', {
			expected: 'redacted client secret',
			actual: 'secret-bearing response',
		});
	}
}

async function publishStillImage({
	format,
	bytes,
	mime,
	fileName,
	eventId,
	origin,
	cookie,
	fetchRequest,
	signal,
}) {
	const digest = createHash('sha256').update(bytes).digest('hex');
	// Digests identify retained content and are deliberately withheld from failure output.
	const operation = await expectJson({
		probe: `${format}-ingestion-initiation`,
		expected: 201,
		origin,
		path: '/api/graphics-assets/ingestion-operations',
		fetchRequest,
		signal,
		init: jsonRequest(
			{
				source: 'local-upload',
				idempotencyKey: `worker-smoke-${format}-${randomUUID()}`,
				name: `Built Worker smoke ${format}`,
				sourceFileName: fileName,
				declaredMime: mime,
				browserDecodeEvidence: {
					outcome: 'decoded',
					sourceDigest: digest,
					width: 1,
					height: 1,
				},
				declaredByteLength: bytes.byteLength,
				defaultEventId: eventId,
				duplicateContentPolicy: 'create-separate',
			},
			{ cookie },
		),
	});
	if (typeof operation?.id !== 'string')
		throwShapeFailure(`${format}-ingestion-initiation`, 'Graphics Ingestion Operation identity');
	const completed = await expectJson({
		probe: `${format}-ingestion-publication`,
		expected: 200,
		origin,
		path: `/api/graphics-assets/ingestion-operations/${operation.id}/content`,
		fetchRequest,
		signal,
		init: {
			method: 'PUT',
			headers: { 'content-type': mime, cookie },
			body: bytes,
		},
	});
	if (
		completed?.stage !== 'completed' ||
		completed?.report?.outcome !== 'accepted' ||
		completed?.report?.facts?.canonicalMime !== mime ||
		completed?.result?.outcome !== 'published' ||
		typeof completed?.result?.assetId !== 'string' ||
		typeof completed?.result?.revisionId !== 'string'
	) {
		throwShapeFailure(
			`${format}-ingestion-publication`,
			`published ${format} Graphic Asset Revision`,
		);
	}
	return { assetId: completed.result.assetId, revisionId: completed.result.revisionId };
}

async function verifyJpegDelivery({
	assetId,
	revisionId,
	bytes,
	origin,
	cookie,
	fetchRequest,
	signal,
}) {
	const path = `/api/graphics-assets/${assetId}/revisions/${revisionId}/content`;
	const complete = await expectStatus({
		probe: 'jpeg-full-delivery',
		expected: 200,
		origin,
		path,
		fetchRequest,
		signal,
		init: {
			headers: { cookie },
		},
	});
	const completeBytes = new Uint8Array(await complete.arrayBuffer());
	if (complete.headers.get('content-type') !== 'image/jpeg' || !sameBytes(completeBytes, bytes))
		throwShapeFailure('jpeg-full-delivery', 'exact JPEG bytes and image/jpeg');
	const range = await expectStatus({
		probe: 'jpeg-range-delivery',
		expected: 206,
		origin,
		path,
		fetchRequest,
		signal,
		init: {
			headers: { cookie, range: 'bytes=1-3' },
		},
	});
	const rangeBytes = new Uint8Array(await range.arrayBuffer());
	if (
		range.headers.get('content-range') !== `bytes 1-3/${bytes.byteLength}` ||
		!sameBytes(rangeBytes, bytes.slice(1, 4))
	) {
		throwShapeFailure('jpeg-range-delivery', 'exact bytes 1-3 with matching Content-Range');
	}
}

function sameBytes(actual, expected) {
	return (
		actual.byteLength === expected.byteLength &&
		actual.every((byte, index) => byte === expected[index])
	);
}
