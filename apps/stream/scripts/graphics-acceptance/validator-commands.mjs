/**
 * Every Wrangler command the silent-video validator gate runs, behind one
 * adapter (#619).
 *
 * The gate is the one acceptance harness that writes with Wrangler rather than
 * over HTTP, so this is the one place a deployed run can touch an account.
 * Three rules live here so no call site can forget them:
 *
 * - **Routing is explicit.** Every remote command names the resolved target's
 *   bucket, Workflow, config and, outside production, the config's `env`
 *   block (#525), and runs with `CLOUDFLARE_ACCOUNT_ID` set to
 *   the target's account, so Wrangler never falls back to whichever account the
 *   shell happens to be logged into.
 * - **An object command is asked again.** R2 answers a second write to one key
 *   within about a second with 429, and get, put and delete are idempotent, so
 *   each is repeated after a growing wait before it counts as failed. A
 *   bucket's answer that a key is absent is an answer, never repeated; nothing
 *   else is repeated, since a Workflow trigger that failed may have started.
 * - **Failures say why, not on what.** A failed command becomes a
 *   `RemoteCommandFailure` carrying the step, exit code and Wrangler's error
 *   reduced to its words, HTTP status and Cloudflare code. Wrangler's arguments
 *   name object keys and its stderr echoes their paths, so the arguments are
 *   never kept and every path and target name is withheld from the reason;
 *   Wrangler's own log under its config directory has the raw detail.
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
import { pageTextEvidence } from './evidence.mjs';

/** What `wrangler r2 object get` says, local or remote, of a key the bucket does not hold. */
const ABSENT_OBJECT = 'The specified key does not exist.';

/**
 * The waits before each repeat of a refused object command. R2 takes about
 * one write a second to a key and answers faster ones 429 (Cloudflare's R2
 * limits, error 10058), and the cleanup manifest is one key the gate rewrites
 * back to back, so the first wait is a second and each doubles.
 */
const OBJECT_RETRY_WAITS_MS = Object.freeze([1000, 2000, 4000]);

export class RemoteCommandFailure extends Error {
	/**
	 * @param {string} step One word naming the command, e.g. `put`.
	 * @param {number | null} exit
	 * @param {string} [reason] Wrangler's error, reduced by `wranglerFailureReason`.
	 */
	constructor(step, exit, reason) {
		super(`wrangler ${step} exited ${exit}`);
		this.name = 'RemoteCommandFailure';
		this.step = step;
		this.exit = exit;
		this.reason = reason;
	}
}

/**
 * A failure's evidence detail: its exit code and, when Wrangler gave one, its
 * redacted reason.
 *
 * @param {RemoteCommandFailure} failure
 */
export function remoteFailureDetail({ exit, reason }) {
	return { exit: exit ?? 'signal', ...(reason === undefined ? {} : { reason }) };
}

/** A run with a slash in it: an API path, an object path, a bucket path. */
const PATH_RUN = /[^\s()[\]"'`]*\/[^\s()[\]"'`]*/g;
/** The Cloudflare error code, as Wrangler notes it or as the JSON body it echoes carries it. */
const CLOUDFLARE_CODE = /\[code: (\d+)\]|"code":\s*(\d+)/;

/**
 * Why Wrangler failed, said without what it failed on: its `[ERROR]` line (else
 * its first line), every path in it withheld and every name of the target
 * replaced by what it was, with the Cloudflare error code it reported. What is
 * left goes through `pageTextEvidence`, so a shape this misses still reaches no
 * one, and the formatter checks it again before it prints.
 *
 * @param {string} stderr
 * @param {{ accountId?: string, stagingBucket?: string, workflow?: string }} target
 */
function wranglerFailureReason(stderr, target) {
	const lines = stripAnsi(stderr)
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
	const errorLine = lines.find((line) => line.includes('[ERROR]')) ?? lines[0];
	if (!errorLine) return undefined;
	let reason = errorLine
		.replace(/^.*?\[ERROR\]\s*/, '')
		.replace(PATH_RUN, '<path>')
		.replace(/;$/, '');
	for (const [name, value] of [
		['account', target.accountId],
		['bucket', target.stagingBucket],
		['workflow', target.workflow],
	])
		if (value) reason = reason.split(value).join(`<${name}>`);
	const code = lines.join('\n').match(CLOUDFLARE_CODE);
	if (code && !reason.includes('[code:')) reason = `${reason} [code: ${code[1] ?? code[2]}]`;
	return pageTextEvidence(reason);
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
 *   sleep?: (ms: number) => Promise<void>,
 * }} options
 */
export function createWranglerCommands({
	repoRoot,
	execute = executeWrangler,
	baseEnv = process.env,
	sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
	/**
	 * `target.local` is a local run's persistence directory. Anything else is a
	 * deployed target, and runs on its own account and nowhere else.
	 */
	async function wrangler(step, target, argumentList, { absentAnswers, idempotent = false } = {}) {
		const env = { ...baseEnv };
		if (!target.local) env[ACCOUNT_ID_ENV] = target.accountId;
		const waits = idempotent ? OBJECT_RETRY_WAITS_MS : [];
		for (let attempt = 0; ; attempt++) {
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
			if (code === 0) return stripAnsi(stdout);
			if (absentAnswers !== undefined && stripAnsi(stderr).includes(ABSENT_OBJECT))
				return absentAnswers;
			if (attempt >= waits.length)
				throw new RemoteCommandFailure(step, code, wranglerFailureReason(stderr, target));
			await sleep(waits[attempt]);
		}
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
		/** The same bytes to the same key: a repeat writes what the first attempt would have. */
		async putObject({ target, key, bytes, contentType }) {
			await withWorkspace(async (file) => {
				await writeFile(file, bytes);
				await wrangler(
					'put',
					target,
					[
						'r2',
						'object',
						'put',
						objectPath(target, key),
						'--file',
						file,
						'--content-type',
						contentType,
						...storage(target),
					],
					{ idempotent: true },
				);
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
					{ absentAnswers: absent, idempotent: true },
				);
				return read === absent ? undefined : await readFile(file);
			});
		},
		/** R2 deletes are idempotent: an absent key deletes successfully, which is what makes a retry safe. */
		async deleteObject({ target, key }) {
			await wrangler(
				'delete',
				target,
				['r2', 'object', 'delete', objectPath(target, key), ...storage(target)],
				{ idempotent: true },
			);
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
