/**
 * The fixture app (`./fixture`) as an app runs: built and served by local
 * `workerd`, and under `nuxt dev`. Both are the real thing, with no credential
 * and nothing remote.
 */
import type { ChildProcess } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createTestHarness } from 'wrangler';

const fixture = fileURLToPath(new URL('./fixture/', import.meta.url));
const nuxt = fileURLToPath(new URL('../../node_modules/.bin/nuxt', import.meta.url));
const HOST = '127.0.0.1';

export interface FixtureServer {
	/** Its origin, with no trailing slash. */
	origin: string;
	stop(): Promise<void>;
}

/** A dev server, which a test may also stop as whatever supervises one does. */
export interface DevServer extends FixtureServer {
	/**
	 * Signal its process and nothing else, and wait for it to exit. Answers what
	 * is still running of it and of all it started: the command of each.
	 */
	stopBySignal(signal: 'SIGINT' | 'SIGTERM'): Promise<string[]>;
}

function exited(child: ChildProcess): Promise<number | null> {
	if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(child.exitCode);
	return new Promise((resolve) => child.once('exit', (code) => resolve(code)));
}

/** A whole process group: `nuxt dev` forks its server, which starts `workerd`. */
function signalGroup(child: ChildProcess, signal: NodeJS.Signals): void {
	try {
		process.kill(-child.pid!, signal);
	} catch {
		// Already gone.
	}
}

/**
 * What runs in a server's process group, by command: the server and all it
 * started, `workerd` among it.
 */
function groupOf(child: ChildProcess): string[] {
	return execFileSync('ps', ['-A', '-o', 'pgid=,command='], { encoding: 'utf8' })
		.split('\n')
		.flatMap((line) => {
			const [, group, command] = line.trim().match(/^(\d+)\s+(.*)$/) ?? [];
			return command !== undefined && Number(group) === child.pid ? [command] : [];
		});
}

/** Servers still running when this process ends, however it ends. */
const running = new Set<ChildProcess>();
process.once('exit', () => {
	for (const child of running) signalGroup(child, 'SIGKILL');
});

function run(
	args: string[],
	env: Record<string, string | undefined> = {},
): { child: ChildProcess; output: () => string } {
	const child = spawn(nuxt, args, {
		cwd: fixture,
		detached: true,
		stdio: ['ignore', 'pipe', 'pipe'],
		env: {
			...process.env,
			NODE_ENV: undefined,
			NUXT_TELEMETRY_DISABLED: '1',
			// Each dev server keeps a registry of its own unless one is named for it.
			WRANGLER_REGISTRY_PATH: undefined,
			...env,
		},
	});
	running.add(child);
	void exited(child).then(() => running.delete(child));
	let output = '';
	for (const stream of [child.stdout, child.stderr])
		stream?.setEncoding('utf8').on('data', (chunk: string) => {
			output = (output + chunk).slice(-8000);
		});
	return { child, output: () => output };
}

/** Build the fixture as an app's `nuxt build` does. */
export async function buildFixture(): Promise<void> {
	const { child, output } = run(['build']);
	const code = await exited(child);
	if (code !== 0) throw new Error(`The fixture's nuxt build failed (${code}):\n${output()}`);
}

/** The built Worker under local `workerd`, as a preview runs it. */
export async function startBuiltWorker(): Promise<FixtureServer> {
	const harness = createTestHarness({
		root: fixture,
		workers: [{ configPath: '.output/server/wrangler.json' }],
	});
	const { url } = await harness.listen();
	return { origin: url.origin, stop: () => harness.close() };
}

async function freePort(): Promise<number> {
	const probe = createServer();
	await new Promise<void>((resolve, reject) => {
		probe.once('error', reject);
		probe.listen(0, HOST, resolve);
	});
	const { port } = probe.address() as AddressInfo;
	await new Promise((resolve) => probe.close(resolve));
	return port;
}

/**
 * What tells a dev server that a suite or CI started it (`std-env`). Nitro then
 * ends its own worker without waiting for it to close, so the `workerd` of its
 * bindings outlives a dev server that was not stopped as a whole group.
 */
const SAYS_UNATTENDED = { TEST: undefined, CI: undefined, GITHUB_ACTIONS: undefined };

/**
 * `nuxt dev`, which starts the Worker that holds the class beside itself.
 * `beside` names a build directory of its own, for a server that runs while
 * another does. `by` a developer, it runs as one started at a terminal does,
 * and closes all it started when it is told to stop.
 */
export async function startDevServer(
	beside?: string,
	by: 'suite' | 'developer' = 'suite',
): Promise<DevServer> {
	const port = await freePort();
	const origin = `http://${HOST}:${port}`;
	const { child, output } = run(['dev', '--host', HOST, '--port', String(port)], {
		...(by === 'developer' ? SAYS_UNATTENDED : {}),
		...(beside === undefined ? {} : { REALTIME_FIXTURE_BUILD_DIR: `.wrangler/nuxt-${beside}` }),
	});
	const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
	const stop = async (): Promise<void> => {
		signalGroup(child, 'SIGTERM');
		await Promise.race([exited(child), sleep(10_000)]);
		// `workerd` may outlive a leader that exited on SIGTERM.
		signalGroup(child, 'SIGKILL');
	};
	const stopBySignal = async (signal: 'SIGINT' | 'SIGTERM'): Promise<string[]> => {
		child.kill(signal);
		await Promise.race([exited(child), sleep(20_000)]);
		// What it stopped on its way out may take a moment to be gone.
		const deadline = Date.now() + 5000;
		while (groupOf(child).length > 0 && Date.now() < deadline) await sleep(50);
		return groupOf(child);
	};

	const deadline = Date.now() + 120_000;
	for (;;) {
		if (child.exitCode !== null || child.signalCode !== null)
			throw new Error(`The fixture's nuxt dev exited before it was ready:\n${output()}`);
		try {
			// A route of the app's own: `nuxt dev` answers 503 until its server is up.
			const response = await fetch(`${origin}/ready`, { signal: AbortSignal.timeout(5000) });
			if (response.ok && (await response.text()) === 'ready') return { origin, stop, stopBySignal };
		} catch {
			// Not listening yet.
		}
		if (Date.now() > deadline) {
			await stop();
			throw new Error(`The fixture's nuxt dev was not ready in time:\n${output()}`);
		}
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
}
