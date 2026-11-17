/**
 * Reap what a stranded Stream Keepr run leaves behind: orphaned workerd (the
 * workspace's reaper, `@keepr/tooling`), and leaked acceptance Chrome.
 *
 * An acceptance Chrome whose runner died is the same kind of orphan as
 * workerd, and worse company: #687 found one spinning at 100% CPU for an hour
 * and a half, slowing every run beside it. It is told apart by its profile,
 * which only an acceptance run in a checkout of this repository uses
 * (`graphics-acceptance/chromium-profile.mjs`).
 *
 *   node scripts/reap.mjs   (`pnpm reap`, and before every gate that starts workerd)
 */

import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
	discoverCheckoutRoots,
	processTable,
	main as reapOrphanedWorkerd,
	terminateAll,
} from '@keepr/tooling/scripts/reap-workerd.mjs';
import {
	acceptanceProfilePrefix,
	checkoutProfileMarker,
} from './graphics-acceptance/chromium-profile.mjs';

/**
 * The pids of every leaked acceptance Chrome: a headless browser whose parent
 * is gone and whose `--user-data-dir` is a profile one of `checkoutRoots`
 * names, and every helper process it spawned. A helper carries the same
 * profile but not always `--headless`, so it is reached through its browser.
 * A person's own Chrome never runs under one of these profiles, and a browser
 * whose runner is still alive is that run's to stop.
 */
export function selectLeakedAcceptanceChrome(psOutput, checkoutRoots) {
	const prefixes = [
		...new Set(checkoutRoots.map((root) => acceptanceProfilePrefix(checkoutProfileMarker(root)))),
	];
	const marked = (command) =>
		prefixes.some((prefix) => new RegExp(`--user-data-dir=\\S*/${prefix}`).test(command));
	const table = processTable(psOutput);
	const selected = new Set(
		table
			.filter(
				(entry) =>
					entry.parentPid === 1 &&
					/\s--headless(?:=\S*)?(?:\s|$)/.test(entry.command) &&
					marked(entry.command),
			)
			.map((entry) => entry.pid),
	);
	let grew = selected.size > 0;
	while (grew) {
		grew = false;
		for (const entry of table) {
			if (!selected.has(entry.pid) && selected.has(entry.parentPid) && marked(entry.command)) {
				selected.add(entry.pid);
				grew = true;
			}
		}
	}
	return table.map((entry) => entry.pid).filter((pid) => selected.has(pid));
}

export async function reapLeakedAcceptanceChrome({ psOutput, checkoutRoots, kill, sleep }) {
	return await terminateAll(selectLeakedAcceptanceChrome(psOutput, checkoutRoots), { kill, sleep });
}

/** This app's directory, wherever the reap is started from. */
const appDirectory = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');

/** Reap from this app's checkout: workerd first, then acceptance Chrome. */
export async function main({ cwd = appDirectory } = {}) {
	await reapOrphanedWorkerd({ cwd });
	const chrome = await reapLeakedAcceptanceChrome({
		psOutput: execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }),
		checkoutRoots: discoverCheckoutRoots(cwd),
		kill: process.kill,
		sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
	});
	if (chrome.length > 0) {
		process.stdout.write(`reap: reaped leaked acceptance Chrome ${chrome.join(', ')}\n`);
	}
}

if (import.meta.main) {
	await main();
}
