#!/usr/bin/env node
/**
 * `pnpm verify:quick` at the root: the quick gates of each project this
 * checkout's change can affect, and the workspace's own checks (ADR-0148).
 *
 * Which projects: `affectedProjects` (`project-graph.mjs`, ADR-0147), the same
 * graph CI's scope reads, over the files that differ from where the branch
 * left `main` (`change-base.mjs`), committed or not. Markdown is left out, as
 * CI's scope leaves it out. With no `main` to measure from, every project.
 *
 * What runs, one after another, stopping at the first failure:
 *
 * 1. The changeset check (`keepr-changeset-check`, ADR-0118).
 * 2. Each affected project's quick gate, the packages before the apps: its
 *    `verify:quick` script, or else its `typecheck` and `test`. Each is told
 *    the root runs the workspace's checks (`WORKSPACE_CHECKED_ENV`), so an
 *    app's `verify:quick` leaves them out.
 * 3. The lint, the whole workspace's, last: it reads each project's
 *    generated tsconfig, which the gates before it prepare.
 *
 * Every heavy gate takes its own run slots (`slots.mjs`); this takes none.
 *
 *   node packages/tooling/scripts/verify-quick.mjs   (`pnpm verify:quick` at the root)
 */

import { execFileSync, spawnSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { changeBase } from './change-base.mjs';
import { affectedProjects } from './project-graph.mjs';
import { workspacePackages } from './versioned-apps.mjs';

/** @typedef {import('./versioned-apps.mjs').WorkspacePackage} WorkspacePackage */
/** @typedef {{ label: string, command: string[], env?: Record<string, string> }} Step */

/** Set for a project's gate the root runs: the changeset check and the lint are the root's. */
export const WORKSPACE_CHECKED_ENV = 'KEEPR_VERIFY_WORKSPACE_CHECKED';
const DOCUMENT = /\.md$/;

/**
 * The files this checkout changes since `base`, committed, staged, unstaged
 * or untracked, from the repository's root.
 *
 * @param {(args: string[]) => string} git runs Git at the repository's root
 * @param {string} base the commit the branch left `main` at
 * @returns {string[]} the paths
 */
export function changedFiles(git, base) {
	const lines = [
		...git(['diff', '--name-only', '--no-renames', base]).split('\n'),
		...git(['ls-files', '--others', '--exclude-standard']).split('\n'),
	];
	return [...new Set(lines.filter(Boolean))];
}

/**
 * What a root `verify:quick` runs for a change.
 *
 * @param {readonly string[] | undefined} changed the changed files; `undefined` when there is no `main` to measure from
 * @param {Map<string, WorkspacePackage>} packages the workspace's packages, by name
 * @returns {{ projects: string[], steps: Step[] }} the affected projects, in the order their gates run, and every step
 */
export function quickPlan(changed, packages) {
	const affected =
		changed === undefined
			? new Set(packages.keys())
			: affectedProjects(
					changed.filter((file) => !DOCUMENT.test(file)),
					packages,
				);
	const projects = [...packages.values()]
		.filter((pkg) => affected.has(pkg.name))
		.toSorted(
			(a, b) =>
				Number(a.dir.startsWith('apps/')) - Number(b.dir.startsWith('apps/')) ||
				a.dir.localeCompare(b.dir),
		);
	const env = { [WORKSPACE_CHECKED_ENV]: '1' };
	/** @type {Step[]} */
	const steps = [{ label: 'changesets', command: ['pnpm', 'exec', 'keepr-changeset-check'] }];
	for (const pkg of projects) {
		const scripts = pkg.scripts ?? {};
		const gates = 'verify:quick' in scripts ? ['verify:quick'] : ['typecheck', 'test'];
		for (const script of gates.filter((name) => name in scripts))
			steps.push({
				label: `${pkg.name} ${script}`,
				command: ['pnpm', '--filter', pkg.name, 'run', script],
				env,
			});
	}
	steps.push({ label: 'lint', command: ['pnpm', 'run', 'lint'] });
	return { projects: projects.map((pkg) => pkg.name), steps };
}

function seconds(ms) {
	return `${(ms / 1000).toFixed(1)}s`;
}

export function main() {
	const root = fileURLToPath(new URL('../../../', import.meta.url));
	const packages = workspacePackages(root);
	const base = changeBase({ cwd: root });
	/** @param {string[]} args */
	const git = (args) =>
		execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
	let changed;
	if (base) {
		try {
			changed = changedFiles(git, base.commit);
		} catch {
			changed = undefined;
		}
	}
	const { projects, steps } = quickPlan(changed, packages);
	const skipped = [...packages.keys()].filter((name) => !projects.includes(name));
	process.stdout.write(
		changed === undefined
			? 'verify:quick: nothing to measure the change from, so every project\n'
			: `verify:quick: ${changed.length} files changed since ${base?.ref}; CI runs every gate of each project the change affects\n`,
	);
	process.stdout.write(`  affected: ${projects.join(', ') || 'none'}\n`);
	if (skipped.length) process.stdout.write(`  not affected: ${skipped.join(', ')}\n`);

	const started = Date.now();
	for (const step of steps) {
		process.stdout.write(`\n▶ ${step.label}\n`);
		const stepStarted = Date.now();
		const [command = 'pnpm', ...args] = step.command;
		const result = spawnSync(command, args, {
			cwd: root,
			stdio: 'inherit',
			env: { ...process.env, ...step.env },
		});
		if (result.status !== 0) {
			process.stderr.write(
				`\n✗ ${step.label} failed (${result.signal ?? `exit ${result.status}`}) after ${seconds(Date.now() - stepStarted)}\n`,
			);
			process.exitCode = result.signal === 'SIGINT' ? 130 : 1;
			return;
		}
		process.stdout.write(`✓ ${step.label} ${seconds(Date.now() - stepStarted)}\n`);
	}
	process.stdout.write(
		`\nverify:quick: ${steps.length} steps passed in ${seconds(Date.now() - started)}\n`,
	);
}

// `import.meta.main`: run as a workspace bin, `argv[1]` names the linked path.
if (import.meta.main) main();
