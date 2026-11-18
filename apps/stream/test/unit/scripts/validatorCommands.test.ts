import { writeFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import {
	createWranglerCommands,
	parseInstanceDescription,
	RemoteCommandFailure,
} from '../../../scripts/graphics-acceptance/validator-commands.mjs';

/**
 * The Wrangler command adapter the validator gate writes through (#619), driven
 * with a fake `execute` so no Wrangler process starts.
 */

const TARGET = {
	accountId: '0123456789abcdef0123456789abcdef',
	stagingBucket: 'a-staging-bucket',
	workflow: 'a-workflow',
	validatorConfigPath: '/repo/validator/wrangler.jsonc',
};
type Target = typeof TARGET & { wranglerEnv?: string };

type Result = { code: number; stdout: string; stderr?: string };

/**
 * A stand-in Wrangler: it downloads an empty object to a `get`'s `--file`, and
 * exits with each of `results` in turn, the last for every call after.
 */
function adapter(...results: Result[]) {
	const answers = results.length > 0 ? results : [{ code: 0, stdout: '' }];
	const execute = vi.fn(
		async (argv: string[], _options: { cwd: string; env: Record<string, string | undefined> }) => {
			if (argv.includes('get')) await writeFile(argv[argv.indexOf('--file') + 1]!, '');
			return answers[Math.min(execute.mock.calls.length, answers.length) - 1]!;
		},
	);
	const sleep = vi.fn(async (_ms: number) => {});
	const commands = createWranglerCommands({
		repoRoot: '/repo',
		execute,
		sleep,
		baseEnv: { PATH: '/bin', CLOUDFLARE_ACCOUNT_ID: 'the-shell-account' },
	});
	return { execute, sleep, commands };
}

/** What Wrangler 4 prints when R2 refuses a second write to one key within a second. */
const RATE_LIMITED: Result = {
	code: 1,
	stdout: '',
	stderr: [
		`\u001B[31m✘ \u001B[41;31m[\u001B[41;97mERROR\u001B[41;31m]\u001B[0m \u001B[1mFailed to fetch /accounts/${TARGET.accountId}/r2/buckets/${TARGET.stagingBucket}/objects/acceptance/silent-video-validator-cleanup.json - 429: Too Many Requests;\u001B[0m`,
		'',
		'  {"success":false,"errors":[{"code":10058,"message":"Rate limit exceeded"}],"messages":[],"result":null}',
		'',
	].join('\n'),
};

describe('the validator command adapter', () => {
	type Commands = ReturnType<typeof adapter>['commands'];

	/** Each command as the gate calls it on a deployed target, and what its arguments must name: the target's bucket or Workflow, and for an object the remote store. */
	const REMOTE: Record<
		string,
		{ run: (commands: Commands, target?: Target) => Promise<unknown>; names: string[] }
	> = {
		probeBucket: {
			run: (commands, target = TARGET) => commands.probeBucket({ target }),
			names: [TARGET.stagingBucket],
		},
		probeWorkflow: {
			run: (commands, target = TARGET) => commands.probeWorkflow({ target }),
			names: [TARGET.workflow],
		},
		putObject: {
			run: (commands, target = TARGET) =>
				commands.putObject({
					target,
					key: 'some/key',
					bytes: new Uint8Array([1]),
					contentType: 'video/mp4',
				}),
			names: [`${TARGET.stagingBucket}/some/key`, '--remote'],
		},
		getObject: {
			run: (commands, target = TARGET) => commands.getObject({ target, key: 'some/key' }),
			names: [`${TARGET.stagingBucket}/some/key`, '--remote'],
		},
		deleteObject: {
			run: (commands, target = TARGET) => commands.deleteObject({ target, key: 'some/key' }),
			names: [`${TARGET.stagingBucket}/some/key`, '--remote'],
		},
		triggerWorkflow: {
			run: (commands, target = TARGET) =>
				commands.triggerWorkflow({
					target,
					id: 'an-id',
					params: { a: 1 },
				}),
			names: [TARGET.workflow],
		},
		describeInstance: {
			run: (commands, target = TARGET) => commands.describeInstance({ target, id: 'an-id' }),
			names: [TARGET.workflow],
		},
	};

	// Every command the adapter has, so one added without a row here fails.
	it.each(Object.keys(adapter().commands))(
		'%s reaches a deployed target on its own account and config, naming its bucket or Workflow',
		async (command) => {
			const { execute, commands } = adapter();
			expect(REMOTE).toHaveProperty(command);
			const { run, names } = REMOTE[command]!;

			await run(commands);

			expect(execute).toHaveBeenCalled();
			for (const [argv, options] of execute.mock.calls) {
				expect(options.env.CLOUDFLARE_ACCOUNT_ID).toBe(TARGET.accountId);
				expect(options.cwd).toBe('/repo');
				expect(argv[argv.indexOf('--config') + 1]).toBe(TARGET.validatorConfigPath);
				expect(argv).toEqual(expect.arrayContaining(names));
				expect(argv).not.toContain('--local');
				expect(argv).not.toContain('--env');
			}
		},
	);

	it('selects, for a staging target, the Wrangler env block it was resolved from', async () => {
		const { execute, commands } = adapter();

		for (const { run } of Object.values(REMOTE))
			await run(commands, { ...TARGET, wranglerEnv: 'staging' });

		expect(execute.mock.calls.map(([argv]) => argv[argv.indexOf('--env') + 1])).toEqual(
			Object.keys(REMOTE).map(() => 'staging'),
		);
	});

	it('keeps a local run local, on no account', async () => {
		const { execute, commands } = adapter();

		await commands.putObject({
			target: { local: '/tmp/state', stagingBucket: 'b', validatorConfigPath: '/c' },
			key: 'k',
			bytes: new Uint8Array([1]),
			contentType: 'video/mp4',
		});

		const [argv, options] = execute.mock.calls[0]!;
		expect(argv).toEqual(expect.arrayContaining(['--local', '--persist-to', '/tmp/state']));
		expect(argv).not.toContain('--remote');
		expect(options.env.CLOUDFLARE_ACCOUNT_ID).toBe('the-shell-account');
	});

	// The cleanup manifest is an object that is absent whenever nothing is pending.
	it.each([
		['answers no object for a key the bucket does not hold', 'The specified key does not exist.'],
		['fails on any other error', 'Authentication error [code: 10000]'],
	])('get %s', async (title, stderr) => {
		const { execute, commands } = adapter({
			code: 1,
			stdout: '',
			stderr: `\u001B[31m✘ [ERROR]\u001B[0m ${stderr}\n`,
		});

		const read = commands.getObject({ target: TARGET, key: 'some/key' });

		if (title.startsWith('answers')) {
			await expect(read).resolves.toBeUndefined();
			// Absence is an answer, not a refusal, so it is not asked again.
			expect(execute).toHaveBeenCalledTimes(1);
		} else await expect(read).rejects.toMatchObject({ step: 'get', exit: 1 });
	});

	// R2 takes one write a second to a key (Cloudflare's R2 limits), and the
	// cleanup manifest is rewritten faster than that; object commands are idempotent.
	it.each([
		['putObject', 'put'],
		['getObject', 'get'],
		['deleteObject', 'delete'],
	] as const)('%s waits and retries a refused attempt', async (command, step) => {
		const { execute, sleep, commands } = adapter(RATE_LIMITED, { code: 0, stdout: '' });

		await REMOTE[command]!.run(commands);

		expect(execute.mock.calls.map(([argv]) => argv[2])).toEqual([step, step]);
		expect(sleep.mock.calls[0]![0]).toBeGreaterThanOrEqual(1000);
	});

	it('gives up on an object command after four attempts, each wait longer than the last', async () => {
		const { execute, sleep, commands } = adapter(RATE_LIMITED);

		await expect(REMOTE.putObject!.run(commands)).rejects.toBeInstanceOf(RemoteCommandFailure);

		expect(execute).toHaveBeenCalledTimes(4);
		expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000, 4000]);
	});

	// A trigger that failed may still have started an instance.
	it('never repeats a Workflow trigger', async () => {
		const { execute, sleep, commands } = adapter(RATE_LIMITED);

		await expect(REMOTE.triggerWorkflow!.run(commands)).rejects.toBeInstanceOf(
			RemoteCommandFailure,
		);

		expect(execute).toHaveBeenCalledTimes(1);
		expect(sleep).not.toHaveBeenCalled();
	});

	it('fails with the step and exit code, never the arguments or what Wrangler printed', async () => {
		const { commands } = adapter({
			code: 1,
			stdout: 'a-staging-bucket/ingestion/acceptance-x-mp4/source not found',
		});

		const error = await commands
			.deleteObject({ target: TARGET, key: 'ingestion/acceptance-x-mp4/source' })
			.catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(RemoteCommandFailure);
		expect(error).toMatchObject({ step: 'delete', exit: 1, message: 'wrangler delete exited 1' });
		expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toMatch(
			/ingestion|acceptance-x|a-staging-bucket/u,
		);
	});

	// The reason is Wrangler's error line with every path and target name withheld.
	it.each([
		[
			'an R2 refusal, with the Cloudflare code from its JSON body',
			RATE_LIMITED.stderr!,
			'Failed to fetch <path> - 429: Too Many Requests [code: 10058]',
		],
		[
			'an API refusal, with the code Wrangler notes under it',
			[
				`✘ [ERROR] A request to the Cloudflare API (/accounts/${TARGET.accountId}/workflows/${TARGET.workflow}) failed.`,
				'',
				'  Authentication error [code: 10000]',
			].join('\n'),
			'A request to the Cloudflare API (<path>) failed. [code: 10000]',
		],
		[
			'a target named bare',
			`✘ [ERROR] Bucket ${TARGET.stagingBucket} not found on ${TARGET.accountId}\n`,
			'Bucket <bucket> not found on <account>',
		],
		['nothing printed', '', undefined],
	])('carries the reason Wrangler gave for %s', async (_title, stderr, reason) => {
		const { commands } = adapter({ code: 1, stdout: '', stderr });

		const error = await REMOTE.probeBucket!.run(commands).catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(RemoteCommandFailure);
		expect((error as RemoteCommandFailure).reason).toBe(reason);
	});
});

describe('reading a described Workflow instance', () => {
	it("reads the status, and the final step's output once complete", () => {
		const text = [
			'Name:      silent-video-validation',
			'Status:    ✅ Completed',
			'  Step: verify',
			'    Output:   "{\\"outcome\\":\\"pending\\"}"',
			'  Step: validate',
			'    Output:   "{\\"outcome\\":\\"accepted\\",\\"seeked\\":true}"',
		].join('\n');

		expect(parseInstanceDescription(text)).toEqual({
			status: '✅ Completed',
			output: { outcome: 'accepted', seeked: true },
		});
	});

	it('reads a running instance as no output yet', () => {
		expect(parseInstanceDescription('Status:    ▶ Running\n')).toEqual({ status: '▶ Running' });
	});
});
