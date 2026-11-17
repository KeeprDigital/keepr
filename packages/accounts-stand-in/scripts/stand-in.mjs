#!/usr/bin/env node
// keepr-accounts-stand-in [-- <command> ...]
//
// Starts the Accounts Stand-in under `wrangler dev`, registered locally as
// `keepr-accounts`, so an App's KEEPR_ACCOUNTS binding reaches it (ADR-0113).
// Given a command, runs it beside the stand-in and stops the stand-in when it
// ends: an App that adopts Keepr Accounts runs `keepr-accounts-stand-in -- nuxt dev`.
//
// KEEPR_ACCOUNTS_STAND_IN=off runs the command alone, for when the real Keepr
// Accounts is running beside the App instead (apps/accounts/README.md).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const wrangler = join(
	dirname(createRequire(import.meta.url).resolve('wrangler/package.json')),
	'bin',
	'wrangler.js',
);

const separator = process.argv.indexOf('--');
const command = separator === -1 ? [] : process.argv.slice(separator + 1);
const standInWanted = process.env.KEEPR_ACCOUNTS_STAND_IN !== 'off';

/** @type {import('node:child_process').ChildProcess[]} */
const children = [];

function stopAll(signal = 'SIGTERM') {
	for (const child of children) if (child.exitCode === null) child.kill(signal);
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stopAll(signal));

if (standInWanted) {
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
			'--show-interactive-dev-session=false',
			'--log-level',
			'warn',
		],
		{ cwd: packageRoot, stdio: ['ignore', 'inherit', 'inherit'] },
	);
	children.push(standIn);
	console.log('[accounts-stand-in] answering as the Local Developer User under "keepr-accounts"');
	standIn.on('exit', (code) => {
		if (command.length === 0) process.exit(code ?? 0);
		console.error(
			`[accounts-stand-in] stopped (${code}); requests that need Keepr Accounts will be refused until it runs again.`,
		);
	});
}

if (command.length > 0) {
	const [file, ...args] = command;
	const child = spawn(file, args, { stdio: 'inherit', shell: process.platform === 'win32' });
	children.push(child);
	child.on('exit', (code, signal) => {
		stopAll();
		process.exit(code ?? (signal ? 1 : 0));
	});
} else if (!standInWanted) {
	console.error('[accounts-stand-in] KEEPR_ACCOUNTS_STAND_IN=off and no command: nothing to run.');
	process.exit(1);
}
