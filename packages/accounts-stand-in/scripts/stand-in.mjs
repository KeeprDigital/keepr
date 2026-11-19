#!/usr/bin/env node
// keepr-accounts-stand-in [-- <command> ...]
//
// Starts the Accounts Stand-in under `wrangler dev`, registered locally as
// `keepr-accounts`, so an App's KEEPR_ACCOUNTS binding reaches it (ADR-0113).
// Given a command, runs it beside the stand-in and stops the stand-in when it
// ends: an App that relies on Keepr Accounts runs `keepr-accounts-stand-in -- nuxt dev`.
//
// A binding finds its Worker through Wrangler's local registry, one directory
// for the whole machine, keyed by the Worker's name. So each run beside a
// command keeps a registry of its own, which the command and every Worker it
// starts inherit as WRANGLER_REGISTRY_PATH: two runs at once, in two worktrees
// or in one integration suite, never find each other's Workers. A registry
// already named is used as it is, and the stand-in alone registers where
// Wrangler registers by default (`registry.mjs`).
//
// KEEPR_ACCOUNTS_STAND_IN=off runs the command alone, for when the real Keepr
// Accounts is running beside the App instead (apps/accounts/README.md).
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
	REGISTRY_ENV,
	STAND_IN_REGISTRY_ENV,
	standInRegistry,
	untilRegistered,
} from './registry.mjs';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const wrangler = join(
	dirname(createRequire(import.meta.url).resolve('wrangler/package.json')),
	'bin',
	'wrangler.js',
);

const separator = process.argv.indexOf('--');
const command = separator === -1 ? [] : process.argv.slice(separator + 1);
const plan = standInRegistry({ env: process.env, besideCommand: command.length > 0 });

/** @type {import('node:child_process').ChildProcess[]} */
const children = [];
let stopping = false;

function stopAll(signal = 'SIGTERM') {
	stopping = true;
	for (const child of children) if (child.exitCode === null) child.kill(signal);
}

// The stand-in keeps nothing, and what Wrangler writes for it is this run's
// own: two started from one checkout at once, as an integration suite starts
// them, would otherwise open the same local state, and workerd refuses to start
// on a locked file.
const state = plan.start
	? mkdtempSync(join(tmpdir(), 'keepr-accounts-stand-in-state-'))
	: undefined;

function dispose() {
	plan.dispose();
	if (state !== undefined) rmSync(state, { recursive: true, force: true });
}

function end(code) {
	dispose();
	process.exit(code);
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stopAll(signal));
process.on('exit', dispose);

/** What the command and the stand-in both read the registry from. */
const env = { ...process.env, ...plan.env };

if (plan.start) {
	const standIn = spawn(
		process.execPath,
		[
			wrangler,
			'dev',
			'--config',
			join(packageRoot, 'stand-in.wrangler.jsonc'),
			'--ip',
			'127.0.0.1',
			// The binding reaches it through the local dev registry, not a port: any free one does.
			'--port',
			'0',
			'--inspector-port',
			'0',
			'--persist-to',
			state,
			'--show-interactive-dev-session=false',
			'--log-level',
			'warn',
		],
		{ cwd: packageRoot, stdio: ['ignore', 'inherit', 'inherit'], env },
	);
	children.push(standIn);
	console.log('[accounts-stand-in] answering as the Local Developer User under "keepr-accounts"');
	standIn.on('exit', (code) => {
		if (command.length === 0) end(code ?? 0);
		if (stopping) return;
		console.error(
			`[accounts-stand-in] stopped (${code}); requests that need Keepr Accounts will be refused until it runs again.`,
		);
	});
	// The command starts once its binding can find the stand-in, so its first
	// request is never refused for a Worker still starting.
	if (command.length > 0 && plan.registry !== undefined) {
		const registered = await untilRegistered(plan.registry, {
			stopped: () => standIn.exitCode !== null || stopping,
		});
		if (!registered) {
			console.error('[accounts-stand-in] did not register; the command was not started.');
			stopAll();
			end(1);
		}
	}
} else if (plan.reason === 'off' && command.length > 0 && process.env[REGISTRY_ENV] === undefined) {
	console.log(
		`[accounts-stand-in] off. A dev server that keeps a registry of its own finds Keepr Accounts only when both were started under one ${REGISTRY_ENV} (packages/accounts-stand-in/README.md).`,
	);
}

if (command.length > 0 && !stopping) {
	const [file, ...args] = command;
	const child = spawn(file, args, {
		stdio: 'inherit',
		shell: process.platform === 'win32',
		env,
	});
	children.push(child);
	child.on('exit', (code, signal) => {
		stopAll();
		end(code ?? (signal ? 1 : 0));
	});
} else if (!plan.start && command.length === 0) {
	console.error(
		plan.reason === 'off'
			? '[accounts-stand-in] KEEPR_ACCOUNTS_STAND_IN=off and no command: nothing to run.'
			: `[accounts-stand-in] one already answers in ${process.env[STAND_IN_REGISTRY_ENV]} and no command was given: nothing to run.`,
	);
	end(1);
}
