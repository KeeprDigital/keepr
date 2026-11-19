import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { standInRegistry } from '../scripts/registry.mjs';

// A binding finds its Worker through Wrangler's local registry, keyed by name.
// Each run beside a command keeps one of its own, so two runs at once never
// find each other's Workers, and a run inside another starts no second stand-in.

describe('where a run registers the Accounts Stand-in', () => {
	const made = '/made/for/this/run';
	const plan = (env: Record<string, string>, besideCommand = true) =>
		standInRegistry({ env, besideCommand, makeDirectory: () => made });

	it.each([
		[
			'a registry of its own beside a command, which the command inherits',
			plan({}),
			{
				start: true,
				registry: made,
				env: { WRANGLER_REGISTRY_PATH: made, KEEPR_ACCOUNTS_STAND_IN_REGISTRY: made },
			},
		],
		[
			"Wrangler's default alone, where an App started apart finds it",
			plan({}, false),
			{ start: true, registry: undefined, env: {} },
		],
		[
			'the registry named for it, left as it was named',
			plan({ WRANGLER_REGISTRY_PATH: '/named' }),
			{ start: true, registry: '/named', env: { KEEPR_ACCOUNTS_STAND_IN_REGISTRY: '/named' } },
		],
		[
			'nowhere inside a run whose stand-in already answers in its registry',
			plan({ WRANGLER_REGISTRY_PATH: '/named', KEEPR_ACCOUNTS_STAND_IN_REGISTRY: '/named' }),
			{ start: false, reason: 'nested', env: {} },
		],
		[
			'a registry of its own when the stand-in it inherited answers in another',
			plan({ KEEPR_ACCOUNTS_STAND_IN_REGISTRY: '/another' }),
			{ start: true, registry: made },
		],
		[
			'nowhere when it is off, leaving the registry to whoever runs Keepr Accounts',
			plan({ KEEPR_ACCOUNTS_STAND_IN: 'off' }),
			{ start: false, reason: 'off', env: {} },
		],
	])('is %s', (_case, decided, expected) => {
		expect(decided).toMatchObject(expected);
	});
});

describe('keepr-accounts-stand-in -- <command>', () => {
	const launcher = fileURLToPath(new URL('../scripts/stand-in.mjs', import.meta.url));
	const scratch = mkdtempSync(join(tmpdir(), 'keepr-accounts-stand-in-test-'));
	afterAll(() => rmSync(scratch, { recursive: true, force: true }));

	/** What the command saw: its registry, and the Workers registered there as it started. */
	const SEES = `const fs = require('node:fs');
		const registry = process.env.WRANGLER_REGISTRY_PATH;
		console.log(JSON.stringify({ registry, workers: fs.readdirSync(registry) }));`;

	async function run(args: string[], env: Record<string, string | undefined> = {}) {
		const child = spawn(process.execPath, [launcher, ...args], {
			env: {
				...process.env,
				WRANGLER_REGISTRY_PATH: undefined,
				KEEPR_ACCOUNTS_STAND_IN: undefined,
				KEEPR_ACCOUNTS_STAND_IN_REGISTRY: undefined,
				...env,
			},
			stdio: ['ignore', 'pipe', 'inherit'],
		});
		let output = '';
		child.stdout.setEncoding('utf8').on('data', (chunk: string) => (output += chunk));
		const code = await new Promise<number | null>((resolve) => child.once('exit', resolve));
		const seen = output
			.split('\n')
			.filter((line) => line.startsWith('{'))
			.map((line) => JSON.parse(line) as { registry: string; workers: string[] });
		return { code, seen };
	}

	it('starts the command once the stand-in is registered, in a registry it removes afterwards', async () => {
		const { code, seen } = await run(['--', process.execPath, '-e', SEES]);

		expect(code).toBe(0);
		expect(seen).toEqual([{ registry: expect.any(String), workers: ['keepr-accounts'] }]);
		expect(existsSync(seen[0]!.registry)).toBe(false);
	}, 60_000);

	// Two stand-ins started from one checkout at once, as an integration suite
	// starts them, must open no file in common: workerd refuses a locked one.
	it('keeps what Wrangler writes for it out of the checkout, in a place of its own', async () => {
		const checkoutState = fileURLToPath(new URL('../.wrangler/state', import.meta.url));
		rmSync(checkoutState, { recursive: true, force: true });

		const { code } = await run(['--', process.execPath, '-e', SEES]);

		expect(code).toBe(0);
		expect(existsSync(checkoutState)).toBe(false);
	}, 60_000);

	// Told to stop by itself, as a supervisor stops one process and not its group,
	// it leaves only once the stand-in has: nothing of the run outlives it.
	it('has stopped the stand-in by the time it leaves, when it alone is told to stop', async () => {
		const child = spawn(
			process.execPath,
			[
				launcher,
				'--',
				process.execPath,
				'-e',
				`const fs = require('node:fs');
				const registry = process.env.WRANGLER_REGISTRY_PATH;
				const { debugPortAddress } = JSON.parse(fs.readFileSync(registry + '/keepr-accounts', 'utf8'));
				// The stand-in is the launcher's other child.
				const standIn = require('node:child_process')
					.execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' })
					.split('\\n')
					.map((line) => line.trim().split(/\\s+/))
					.find(([pid, ppid, ...argv]) => Number(ppid) === process.ppid && argv.join(' ').includes('stand-in.wrangler.jsonc'));
				console.log(JSON.stringify({ registry, debugPortAddress, standIn: Number(standIn[0]) }));
				setInterval(() => {}, 1000);`,
			],
			{
				env: {
					...process.env,
					WRANGLER_REGISTRY_PATH: undefined,
					KEEPR_ACCOUNTS_STAND_IN: undefined,
					KEEPR_ACCOUNTS_STAND_IN_REGISTRY: undefined,
				},
				stdio: ['ignore', 'pipe', 'inherit'],
			},
		);
		const exit = new Promise((resolve) => child.once('exit', resolve));
		const { registry, debugPortAddress, standIn } = await new Promise<{
			registry: string;
			debugPortAddress: string;
			standIn: number;
		}>((resolve) => {
			let output = '';
			child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
				output += chunk;
				const line = output.split('\n').find((each) => each.startsWith('{') && each.endsWith('}'));
				if (line) resolve(JSON.parse(line));
			});
		});
		const [host, port] = debugPortAddress.split(':');
		const answers = () =>
			new Promise<boolean>((resolve) => {
				const socket = connect({ host: host!, port: Number(port) });
				socket.once('connect', () => resolve(true)).once('error', () => resolve(false));
				socket.setTimeout(1000, () => resolve(false));
			});
		const alive = (pid: number) => {
			try {
				return process.kill(pid, 0);
			} catch {
				return false;
			}
		};
		expect(await answers()).toBe(true);
		expect(alive(standIn)).toBe(true);

		child.kill('SIGINT');
		await exit;

		expect(alive(standIn)).toBe(false);
		expect(await answers()).toBe(false);
		expect(existsSync(registry)).toBe(false);
	}, 60_000);

	it('gives two runs at once a registry each, and a run inside one no second stand-in', async () => {
		const nested = [
			'--',
			process.execPath,
			launcher,
			'--',
			process.execPath,
			'-e',
			`${SEES} process.exit(7);`,
		];
		const [one, other] = await Promise.all([
			run(nested),
			run(['--', process.execPath, '-e', SEES]),
		]);

		expect(one.code).toBe(7);
		expect(one.seen[0]!.workers).toEqual(['keepr-accounts']);
		expect(other.seen[0]!.workers).toEqual(['keepr-accounts']);
		expect(one.seen[0]!.registry).not.toBe(other.seen[0]!.registry);
	}, 60_000);

	it('registers nothing when it is off, and leaves a named registry as it was named', async () => {
		const { code, seen } = await run(['--', process.execPath, '-e', SEES], {
			KEEPR_ACCOUNTS_STAND_IN: 'off',
			WRANGLER_REGISTRY_PATH: scratch,
		});

		expect(code).toBe(0);
		expect(seen).toEqual([{ registry: scratch, workers: [] }]);
		expect(readdirSync(scratch)).toEqual([]);
	}, 60_000);
});
