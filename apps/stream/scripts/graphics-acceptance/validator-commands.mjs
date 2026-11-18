/**
 * Every Wrangler command the silent-video validator gate runs, behind one
 * adapter (#619).
 *
 * The gate is the one acceptance harness that writes with Wrangler rather than
 * over HTTP, so this is the one place a deployed run can touch an account. Two
 * rules live here so no call site can forget them:
 *
 * - **Routing is explicit.** Every remote command names the resolved target's
 *   bucket, Workflow, config and, outside production, the config's `env`
 *   block (#525), and runs with `CLOUDFLARE_ACCOUNT_ID` set to
 *   the target's account, so Wrangler never falls back to whichever account the
 *   shell happens to be logged into.
 * - **Failures say nothing.** A failed command becomes a `RemoteCommandFailure`
 *   carrying the step and exit code only. Wrangler's arguments name object keys
 *   and its stderr can echo them, so neither is kept; Wrangler's own log under
 *   its config directory has the raw detail for whoever is debugging.
 *
 * The harness takes this object as a dependency, so its tests drive a fake and
 * nothing in the unit suite can reach Wrangler.
 */

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { ACCOUNT_ID_ENV } from './deployed-target.mjs';

/** What `wrangler r2 object get` says, local or remote, of a key the bucket does not hold. */
const ABSENT_OBJECT = 'The specified key does not exist.';

export class RemoteCommandFailure extends Error {
	/**
	 * @param {string} step One word naming the command, e.g. `put`.
	 * @param {number | null} exit
	 */
	constructor(step, exit) {
		super(`wrangler ${step} exited ${exit}`);
		this.name = 'RemoteCommandFailure';
		this.step = step;
		this.exit = exit;
	}
}

/**
 * Wrangler colourises even when piped, and ignores NO_COLOR/FORCE_COLOR — an
 * ANSI prefix on the `Status:` line defeats a `^Status:` anchor, which read as
 * "deployed validation did not complete in time" while the workflow had
 * completed in seconds. This output is parsed, so the codes are stripped once.
 */
function stripAnsi(text) {
	// oxlint-disable-next-line no-control-regex
	return text.replace(/\x1B\[[0-9;]*m/g, '');
}

/**
 * Run `wrangler` and answer with its exit code, stdout and stderr. Stderr is
 * never evidence: the adapter reads it only for Wrangler's own fixed words.
 *
 * @param {string[]} argumentList
 * @param {{ cwd: string, env: Record<string, string | undefined> }} options
 */
export function executeWrangler(argumentList, { cwd, env }) {
	return new Promise((resolve, reject) => {
		const child = spawn('npx', ['wrangler', ...argumentList], {
			cwd,
			env,
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let stdout = '';
		let stderr = '';
		child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
		child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
		child.once('error', reject);
		child.once('close', (code) => resolve({ code, stdout, stderr }));
	});
}

/**
 * A described instance's status word and, once complete, the Workflow's return.
 * The final step's `Output:` line carries it as an escaped JSON string literal.
 */
export function parseInstanceDescription(text) {
	const status = text.match(/^Status:[^\S\n]+(\S[^\n]*)$/m)?.[1]?.trim() ?? '';
	if (!status.includes('Complete')) return { status };
	const raw = [...text.matchAll(/^\s+Output:\s+("(?:\\.|[^"\\])*")$/gm)].at(-1)?.[1];
	try {
		return {
			status,
			output: raw ? JSON.parse(JSON.parse(raw)) : undefined,
		};
	} catch {
		return { status, output: undefined };
	}
}

/**
 * @param {{
 *   repoRoot: string,
 *   execute?: typeof executeWrangler,
 *   baseEnv?: Record<string, string | undefined>,
 * }} options
 */
export function createWranglerCommands({
	repoRoot,
	execute = executeWrangler,
	baseEnv = process.env,
}) {
	/**
	 * `target.local` is a local run's persistence directory. Anything else is a
	 * deployed target, and runs on its own account and nowhere else.
	 */
	async function wrangler(step, target, argumentList, { absentAnswers } = {}) {
		const env = { ...baseEnv };
		if (!target.local) env[ACCOUNT_ID_ENV] = target.accountId;
		const {
			code,
			stdout,
			stderr = '',
		} = await execute(
			[
				...argumentList,
				'--config',
				target.validatorConfigPath,
				...(target.wranglerEnv === undefined ? [] : ['--env', target.wranglerEnv]),
			],
			{ cwd: repoRoot, env },
		);
		if (code !== 0 && absentAnswers !== undefined && stripAnsi(stderr).includes(ABSENT_OBJECT))
			return absentAnswers;
		if (code !== 0) throw new RemoteCommandFailure(step, code);
		return stripAnsi(stdout);
	}

	const storage = (target) =>
		target.local ? ['--local', '--persist-to', target.local] : ['--remote'];
	const objectPath = (target, key) => `${target.stagingBucket}/${key}`;

	async function withWorkspace(use) {
		const workspace = await mkdtemp(join(tmpdir(), 'silent-video-acceptance-'));
		try {
			return await use(join(workspace, 'object.bin'));
		} finally {
			await rm(workspace, { recursive: true, force: true });
		}
	}

	return {
		async probeBucket({ target }) {
			await wrangler('bucket-info', target, ['r2', 'bucket', 'info', target.stagingBucket]);
		},
		async probeWorkflow({ target }) {
			await wrangler('workflow-describe', target, ['workflows', 'describe', target.workflow]);
		},
		async putObject({ target, key, bytes, contentType }) {
			await withWorkspace(async (file) => {
				await writeFile(file, bytes);
				await wrangler('put', target, [
					'r2',
					'object',
					'put',
					objectPath(target, key),
					'--file',
					file,
					'--content-type',
					contentType,
					...storage(target),
				]);
			});
		},
		/** The object's bytes, or undefined when the bucket holds no such key. */
		async getObject({ target, key }) {
			return await withWorkspace(async (file) => {
				const absent = Symbol('absent');
				const read = await wrangler(
					'get',
					target,
					['r2', 'object', 'get', objectPath(target, key), '--file', file, ...storage(target)],
					{ absentAnswers: absent },
				);
				return read === absent ? undefined : await readFile(file);
			});
		},
		/** R2 deletes are idempotent: an absent key deletes successfully, which is what makes a retry safe. */
		async deleteObject({ target, key }) {
			await wrangler('delete', target, [
				'r2',
				'object',
				'delete',
				objectPath(target, key),
				...storage(target),
			]);
		},
		async triggerWorkflow({ target, id, params }) {
			await wrangler('trigger', target, [
				'workflows',
				'trigger',
				target.workflow,
				JSON.stringify(params),
				'--id',
				id,
			]);
		},
		async describeInstance({ target, id }) {
			return parseInstanceDescription(
				await wrangler('describe', target, [
					'workflows',
					'instances',
					'describe',
					target.workflow,
					id,
				]),
			);
		},
	};
}
