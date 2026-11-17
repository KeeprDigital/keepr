#!/usr/bin/env node
/**
 * Reap orphaned local workerd processes before spawning a new one.
 *
 * Miniflare only kills its workerd child from exit hooks covering SIGINT,
 * SIGTERM, and normal exit. A dev server or test runner ending by SIGKILL or
 * SIGHUP (a force-killed background task, a closed terminal) strands workerd
 * with no parent, holding memory and sqlite locks on the persist directories.
 * An orphan is unambiguous: its parent pid is 1 and its binary lives under a
 * checkout of this repository — a live session's workerd always has a live
 * node parent.
 *
 * An app reaps what else its own runs strand beside this, through
 * `discoverCheckoutRoots` and `terminateAll` (Stream Keepr's acceptance
 * Chrome: `apps/stream/scripts/reap.mjs`).
 *
 *   keepr-reap-workerd   (from any directory of a checkout)
 */

import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';

// `ps` cannot quote the executable out of the command line, so a checkout path
// with spaces is matched by prefix: below a checkout root, the path to the
// binary itself never contains whitespace.
const WORKERD_BELOW_ROOT = /^\S*\/bin\/workerd(?:\s|$)/;

function runsWorkerdFrom(command, root) {
	return command.startsWith(`${root}/`) && WORKERD_BELOW_ROOT.test(command.slice(root.length + 1));
}

export function processTable(psOutput) {
	return psOutput
		.split('\n')
		.map((line) => {
			const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\S.*)$/);
			return (
				match && {
					pid: Number(match[1]),
					parentPid: Number(match[2]),
					command: match[3],
				}
			);
		})
		.filter(Boolean);
}

export function selectOrphanedWorkerd(psOutput, checkoutRoots) {
	return processTable(psOutput)
		.filter(
			(entry) =>
				entry.parentPid === 1 && checkoutRoots.some((root) => runsWorkerdFrom(entry.command, root)),
		)
		.map((entry) => entry.pid);
}

const TERMINATION_GRACE_MS = 2000;

/** SIGTERM each pid, then SIGKILL whichever survive the grace; returns those signalled. */
export async function terminateAll(pids, { kill, sleep }) {
	if (pids.length === 0) {
		return [];
	}
	const signalIgnoringGone = (pid, signal) => {
		try {
			kill(pid, signal);
			return true;
		} catch {
			return false;
		}
	};
	// An orphan that exited between `ps` and the signal was never reaped.
	const signalled = pids.filter((pid) => signalIgnoringGone(pid, 'SIGTERM'));
	if (signalled.length === 0) {
		return [];
	}
	await sleep(TERMINATION_GRACE_MS);
	for (const pid of signalled) {
		if (signalIgnoringGone(pid, 0)) {
			signalIgnoringGone(pid, 'SIGKILL');
		}
	}
	return signalled;
}

export async function reapOrphanedWorkerd({ psOutput, checkoutRoots, kill, sleep }) {
	return await terminateAll(selectOrphanedWorkerd(psOutput, checkoutRoots), { kill, sleep });
}

/**
 * Every checkout of this repository is in scope, wherever Git registered it:
 * a worktree may sit under the main checkout (`.claude/worktrees/`) or in a
 * tool's own directory outside it, and a reap fired from any of them covers
 * orphans the others left behind. Each root is also kept as its real path,
 * because the executable path workerd runs under has its symlinks resolved.
 *
 * `cwd` may be below the checkout's root, as an app's directory is
 * (`apps/stream`). workerd runs from the workspace's `node_modules`, under the
 * checkout's root, while what an app names after its own directory (an
 * acceptance browser's profile) is below it. So each checkout answers with both.
 */
export function discoverCheckoutRoots(cwd) {
	const git = (...args) =>
		execFileSync('git', args, {
			cwd,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		});
	const realPathOrSame = (path) => {
		try {
			return realpathSync(path);
		} catch {
			return path;
		}
	};
	const roots = [cwd];
	try {
		// Where `cwd` is below its checkout's root: `apps/stream/`, or nothing at the root.
		const below = git('rev-parse', '--show-prefix').trim();
		roots.push(
			...git('worktree', 'list', '--porcelain', '-z')
				.split('\0')
				.filter((field) => field.startsWith('worktree '))
				.map((field) => field.slice('worktree '.length))
				.flatMap((root) => (below ? [root, join(root, below).replace(/\/$/, '')] : [root])),
		);
	} catch {
		// Git before 2.36 has no `-z` here; the main checkout still covers the
		// worktrees nested under it.
		try {
			roots.push(dirname(git('rev-parse', '--path-format=absolute', '--git-common-dir').trim()));
		} catch {}
	}
	return [...new Set(roots.flatMap((root) => [root, realPathOrSame(root)]))];
}

/** Reap from the checkout holding `cwd`; answers the pids reaped. */
export async function main({ cwd = process.cwd() } = {}) {
	const psOutput = execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' });
	const reaped = await reapOrphanedWorkerd({
		psOutput,
		checkoutRoots: discoverCheckoutRoots(cwd),
		kill: process.kill,
		sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
	});
	if (reaped.length > 0) {
		process.stdout.write(`reap-workerd: reaped orphaned workerd ${reaped.join(', ')}\n`);
	}
	return reaped;
}

// `import.meta.main`, not a comparison with `argv[1]`: run as a workspace bin,
// `argv[1]` names the linked path and this module its real one.
if (import.meta.main) {
	await main();
}
