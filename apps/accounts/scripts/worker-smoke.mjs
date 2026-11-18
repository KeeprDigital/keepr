/**
 * `pnpm worker:smoke`: starts the already-built Worker under local workerd, on
 * a throwaway database with the real migrations, and probes what a deploy
 * relies on: the release identity the deploy's verify requires (ADR-0119), the
 * sign-in page, the Identity Proof's keys (D1 and the sign-in secret, read
 * together), and a refused sign-in (Better Auth's password check on workerd).
 *
 * It never builds: the deploy descriptor's `build`, CI's Worker leg and a
 * deploy run `build` and `worker:dry-run` first, and hand the same artifact
 * here. Nothing is sent: `wrangler dev` simulates the email binding.
 */

import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { verifyDeployment } from '@keepr/tooling/scripts/deploy/verify.mjs';

const appRoot = fileURLToPath(new URL('../', import.meta.url));
const config = join(appRoot, '.output/server/wrangler.json');
const wrangler = join(appRoot, 'node_modules/.bin/wrangler');
const READY_TIMEOUT_MS = 60_000;

/** @param {string} message */
function fail(message) {
	throw new Error(`worker:smoke: ${message}`);
}

/** A free loopback port, for the Worker and its inspector. */
async function freePort() {
	return await new Promise((resolve, reject) => {
		const server = createServer();
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			server.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
		});
	});
}

/** What `/api/release` must name: this checkout, as the build recorded it. */
function checkoutIdentity() {
	const { version } = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8'));
	let commit;
	try {
		commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: appRoot, encoding: 'utf8' }).trim();
	} catch {
		commit = 'unknown';
	}
	return { app: 'accounts', version, commit };
}

/**
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} env
 */
function runWrangler(args, env) {
	execFileSync(wrangler, args, { cwd: appRoot, env, stdio: ['ignore', 'inherit', 'inherit'] });
}

/**
 * @param {import('node:child_process').ChildProcess} child
 * @param {string} origin
 */
async function waitUntilServing(child, origin) {
	const deadline = Date.now() + READY_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (child.exitCode !== null || child.signalCode !== null)
			fail(`the Worker exited before serving (${child.exitCode ?? child.signalCode})`);
		try {
			await fetch(`${origin}/api/release`, { signal: AbortSignal.timeout(2_000) });
			return;
		} catch {
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
	}
	fail(`the Worker did not serve within ${READY_TIMEOUT_MS}ms`);
}

/** @param {string} origin */
async function probe(origin) {
	await verifyDeployment({ baseUrl: origin, expected: checkoutIdentity(), attempts: 1 });
	console.log('worker:smoke: /api/release names this checkout');

	const signIn = await fetch(`${origin}/sign-in`);
	if (signIn.status !== 200 || !signIn.headers.get('content-type')?.includes('text/html'))
		fail(`/sign-in answered ${signIn.status} ${signIn.headers.get('content-type')}`);
	console.log('worker:smoke: /sign-in serves its page');

	const jwks = await fetch(`${origin}/api/auth/jwks`);
	const { keys } = /** @type {{ keys?: unknown[] }} */ (
		jwks.status === 200 ? await jwks.json() : {}
	);
	if (!Array.isArray(keys) || keys.length === 0)
		fail(`/api/auth/jwks answered ${jwks.status} with no keys`);
	console.log('worker:smoke: /api/auth/jwks publishes the Identity Proof keys');

	const refused = await fetch(`${origin}/api/auth/sign-in/email`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', origin },
		body: JSON.stringify({ email: 'nobody@keepr.digital', password: 'not-their-password' }),
	});
	if (refused.status !== 401) fail(`a sign-in with no User answered ${refused.status}, not 401`);
	console.log('worker:smoke: a sign-in with no User is refused 401');
}

async function main() {
	if (!existsSync(config)) fail('.output/server/wrangler.json is missing: run pnpm build first');
	const state = await mkdtemp(join(tmpdir(), 'keepr-accounts-worker-smoke-'));
	// Its own registry, so this Worker is not what a running App's binding reaches.
	const env = { ...process.env, WRANGLER_REGISTRY_PATH: join(state, 'registry') };
	const persist = join(state, 'd1');
	/** @type {import('node:child_process').ChildProcess | undefined} */
	let worker;
	try {
		runWrangler(
			['d1', 'migrations', 'apply', 'DB', '--local', '--config', config, '--persist-to', persist],
			env,
		);
		const port = await freePort();
		const origin = `http://127.0.0.1:${port}`;
		worker = spawn(
			wrangler,
			[
				'dev',
				'--local',
				'--config',
				config,
				'--persist-to',
				persist,
				'--ip',
				'127.0.0.1',
				'--port',
				String(port),
				'--inspector-port',
				String(await freePort()),
				'--show-interactive-dev-session=false',
				'--log-level',
				'warn',
				// A throwaway sign-in secret: the Worker answers 503 without one.
				'--var',
				`NUXT_BETTER_AUTH_SECRET:${randomBytes(32).toString('base64url')}`,
			],
			{ cwd: appRoot, env, detached: true, stdio: ['ignore', 'inherit', 'inherit'] },
		);
		await waitUntilServing(worker, origin);
		await probe(origin);
		console.log('worker:smoke: passed');
	} finally {
		if (worker?.pid && worker.exitCode === null) {
			const exited = new Promise((resolve) => worker?.once('exit', resolve));
			// The whole group: wrangler, and the workerd it started.
			process.kill(-worker.pid, 'SIGTERM');
			await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
		}
		await rm(state, { recursive: true, force: true });
	}
}

try {
	await main();
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
}
