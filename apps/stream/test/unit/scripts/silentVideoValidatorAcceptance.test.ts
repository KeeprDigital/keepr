import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MANIFEST_KEY } from '../../../scripts/graphics-acceptance/cleanup-manifest.mjs';
import { RemoteCommandFailure } from '../../../scripts/graphics-acceptance/validator-commands.mjs';
import { main } from '../../../scripts/run-silent-video-validator-acceptance.mjs';

/**
 * The deployed silent-video validator gate, driven against a fake command
 * adapter (#619). Nothing here reaches Wrangler or an account: the adapter is
 * the only way the runner touches either, and the fake records every call.
 */

const ACCOUNT = '0123456789abcdef0123456789abcdef';
const STAGING_ACCOUNT = 'fedcba9876543210fedcba9876543210';
const BUCKET = 'stream-graphics-asset-staging';
const WORKFLOW = 'silent-video-validation';

const ENV = {
	STREAM_KEEPR_BROWSER_ACCEPTANCE_URL: 'https://stream.keepr.digital',
	STREAM_KEEPR_ACCEPTANCE_OPERATOR_EMAIL: 'ops@keepr.digital',
	STREAM_KEEPR_ACCEPTANCE_OPERATOR_PASSWORD: 'their-password',
	CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
};

const STAGING_ENV = {
	...ENV,
	STREAM_KEEPR_BROWSER_ACCEPTANCE_URL: 'https://stream.keepr-staging.digital',
	CLOUDFLARE_ACCOUNT_ID: STAGING_ACCOUNT,
	STREAM_KEEPR_ACCEPTANCE_ENVIRONMENT: 'staging',
};

const APP_BINDINGS = {
	r2_buckets: [{ binding: 'GRAPHICS_ASSET_STAGING', bucket_name: BUCKET }],
	services: [
		{ binding: 'SILENT_VIDEO_PLAYBACK_VALIDATOR', service: 'stream-silent-video-validator' },
	],
};
const VALIDATOR_BINDINGS = {
	name: 'stream-silent-video-validator',
	r2_buckets: [{ binding: 'GRAPHICS_ASSET_STAGING', bucket_name: BUCKET }],
	workflows: [{ name: WORKFLOW, binding: 'SILENT_VIDEO_VALIDATION_WORKFLOW' }],
};

/** Production at the top level, staging in `env.staging`: same names, another account. */
const INSTALLATION = {
	app: {
		routes: [{ pattern: 'stream.keepr.digital', custom_domain: true }],
		...APP_BINDINGS,
		env: {
			staging: {
				routes: [{ pattern: 'stream.keepr-staging.digital', custom_domain: true }],
				...APP_BINDINGS,
			},
		},
	},
	validator: { ...VALIDATOR_BINDINGS, env: { staging: VALIDATOR_BINDINGS } },
	validatorConfigPath: '/repo/workers/silent-video-validator/wrangler.jsonc',
};

const MUTATIONS = new Set(['put', 'trigger', 'delete']);

/**
 * A command failure whose message carries everything the evidence contract
 * withholds, so a runner that printed a message would fail `expectSafe`.
 */
function rawFailure(step: string, key: string) {
	return Object.assign(new RemoteCommandFailure(step, 1), {
		message: `wrangler r2 object ${step} ${BUCKET}/${key} --remote: ✘ [ERROR] ${'a'.repeat(64)}`,
	});
}

interface FakeOptions {
	failPut?: boolean;
	failManifestWrite?: boolean;
	failDeletes?: number;
	failProbe?: 'bucket' | 'workflow';
	outcome?: string;
	neverSettle?: boolean;
}

/** Each account's staging bucket, outliving any one run and any one machine. */
type Cloudflare = Map<string, Map<string, Uint8Array>>;

function fakeCommands(options: FakeOptions = {}, cloudflare: Cloudflare = new Map()) {
	const calls: {
		op: string;
		accountId: string;
		bucket?: string;
		workflow?: string;
		key?: string;
	}[] = [];
	const instances = new Map<string, object>();
	let deleteFailures = options.failDeletes ?? 0;
	const bucketOf = (accountId = ACCOUNT) => {
		if (!cloudflare.has(accountId)) cloudflare.set(accountId, new Map());
		return cloudflare.get(accountId)!;
	};
	const log = (
		op: string,
		target: { accountId: string; stagingBucket: string; workflow: string },
		key?: string,
	) =>
		calls.push({
			op,
			accountId: target.accountId,
			bucket: target.stagingBucket,
			workflow: target.workflow,
			key,
		});

	return {
		calls,
		bucket: bucketOf,
		async probeBucket({ target }: any) {
			log('probe-bucket', target);
			if (options.failProbe === 'bucket') throw rawFailure('info', '');
		},
		async probeWorkflow({ target }: any) {
			log('probe-workflow', target);
			if (options.failProbe === 'workflow') throw rawFailure('describe', '');
		},
		async putObject({ target, key, bytes }: any) {
			log('put', target, key);
			if (key === MANIFEST_KEY ? options.failManifestWrite : options.failPut)
				throw rawFailure('put', key);
			bucketOf(target.accountId).set(key, bytes);
		},
		async getObject({ target, key }: any) {
			log('get', target, key);
			return bucketOf(target.accountId).get(key);
		},
		async deleteObject({ target, key }: any) {
			log('delete', target, key);
			if (key !== MANIFEST_KEY && deleteFailures > 0) {
				deleteFailures -= 1;
				throw rawFailure('delete', key);
			}
			bucketOf(target.accountId).delete(key);
		},
		/** Plays the deployed Workflow: renders a poster and settles with its output. */
		async triggerWorkflow({ target, id, params }: any) {
			log('trigger', target);
			const posterKey = `validation/silent-video/${id}/poster`;
			const poster = Buffer.from(`poster for ${id}`);
			bucketOf(target.accountId).set(posterKey, poster);
			instances.set(id, {
				outcome: options.outcome ?? 'accepted',
				idempotencyKey: params.idempotencyKey,
				mutedInlinePlayback: true,
				seeked: true,
				transparencyRendered: true,
				posterKey,
				posterDigest: createHash('sha256').update(poster).digest('hex'),
			});
		},
		async describeInstance({ target, id }: any) {
			log('describe', target);
			return options.neverSettle
				? { status: 'Running' }
				: {
						status: 'Complete',
						output: instances.get(id),
					};
		},
	};
}

/** The cleanup manifest an account's staging bucket holds, or undefined. */
function manifestIn(commands: ReturnType<typeof fakeCommands>, accountId = ACCOUNT) {
	const bytes = commands.bucket(accountId).get(MANIFEST_KEY);
	return bytes && JSON.parse(Buffer.from(bytes).toString('utf8'));
}

let workspace: string;
let output: string;

beforeEach(async () => {
	workspace = await mkdtemp(join(tmpdir(), 'validator-acceptance-test-'));
	output = '';
	const capture = (chunk: unknown) => {
		output += String(chunk);
		return true;
	};
	vi.spyOn(process.stdout, 'write').mockImplementation(capture);
	vi.spyOn(process.stderr, 'write').mockImplementation(capture);
});

afterEach(async () => {
	vi.restoreAllMocks();
	process.exitCode = undefined;
	await rm(workspace, { recursive: true, force: true });
});

async function run(
	commands: ReturnType<typeof fakeCommands>,
	{
		env = ENV as Record<string, string | undefined>,
		flags = ['--deployed'],
		cacheDirectory = workspace,
	} = {},
) {
	const openSession = vi.fn(async () => ['session=a-session-cookie-value']);
	process.exitCode = undefined;
	await main(['node', 'run-silent-video-validator-acceptance.mjs', ...flags], {
		commands,
		env,
		installation: INSTALLATION,
		cacheDirectory,
		openSession,
		pollIntervalMs: 0,
	});
	return { exitCode: process.exitCode, openSession };
}

function mutations(commands: ReturnType<typeof fakeCommands>) {
	return commands.calls.filter((call) => MUTATIONS.has(call.op));
}

/** What the run staged and triggered: the fixtures' writes, not the manifest's. */
function staged(commands: ReturnType<typeof fakeCommands>) {
	return commands.calls.filter(
		(call) => (call.op === 'put' && call.key !== MANIFEST_KEY) || call.op === 'trigger',
	);
}

/** Nothing the evidence contract withholds: keys, digests, ids, filenames, Wrangler arguments, raw stderr. */
function expectSafe(text: string) {
	expect(text).not.toMatch(
		/ingestion\/|validation\/silent-video|acceptance-[a-z0-9]+-|[0-9a-f]{32}|--remote|\[ERROR\]|\.mp4|\.webm|\.json/u,
	);
}

describe('deployed validator acceptance: preflight', () => {
	it.each([
		['no account', { ...ENV, CLOUDFLARE_ACCOUNT_ID: undefined }, 'harness-precondition-unmet'],
		[
			'no acceptance URL',
			{ ...ENV, STREAM_KEEPR_BROWSER_ACCEPTANCE_URL: undefined },
			'harness-precondition-unmet',
		],
		[
			'no operator',
			{ ...ENV, STREAM_KEEPR_ACCEPTANCE_OPERATOR_PASSWORD: undefined },
			'harness-operator-unavailable',
		],
		[
			'an alternate URL',
			{ ...ENV, STREAM_KEEPR_BROWSER_ACCEPTANCE_URL: 'https://staging.keepr.digital' },
			'harness-target-inconsistent',
		],
	])('touches nothing with %s', async (_, env, code) => {
		const commands = fakeCommands();
		const { exitCode, openSession } = await run(commands, { env });

		expect(exitCode).toBe(1);
		expect(commands.calls).toEqual([]);
		expect(openSession).not.toHaveBeenCalled();
		expect(output).toContain(`silent-video-validator-v1 ${code}`);
		expectSafe(output);
	});

	it.each(['bucket', 'workflow'] as const)(
		'writes nothing when the account does not hold the %s',
		async (probe) => {
			const commands = fakeCommands({ failProbe: probe });
			const { exitCode, openSession } = await run(commands);

			expect(exitCode).toBe(1);
			expect(mutations(commands)).toEqual([]);
			// A bootstrapping sign-in creates or resets an account, so it waits for the probes.
			expect(openSession).not.toHaveBeenCalled();
			expect(output).toContain(`silent-video-validator-v1 harness-target-unverified step=${probe}`);
			expectSafe(output);
		},
	);

	it('signs in as the operator before the first write', async () => {
		const commands = fakeCommands();
		const { openSession } = await run(commands);

		expect(openSession).toHaveBeenCalledWith('https://stream.keepr.digital');
	});

	it('cannot reach Wrangler from an imported main that injected nothing', async () => {
		// Only the CLI entry point passes the real commands (#619).
		await main(['node', 'run-silent-video-validator-acceptance.mjs', '--deployed'], {
			env: ENV,
			installation: INSTALLATION,
			cacheDirectory: workspace,
		});

		expect(process.exitCode).toBe(1);
		expect(output).toContain('silent-video-validator-v1 harness-precondition-unmet reason=Error');
	});
});

describe('deployed validator acceptance: routing', () => {
	it('stages, triggers, reads and deletes only in the resolved account, bucket and Workflow', async () => {
		const commands = fakeCommands();
		const { exitCode } = await run(commands);

		expect(exitCode).toBeUndefined();
		expect(
			new Set(
				commands.calls.map(
					({ accountId, bucket, workflow }) => `${accountId} ${bucket} ${workflow}`,
				),
			),
		).toEqual(new Set([`${ACCOUNT} ${BUCKET} ${WORKFLOW}`]));
		expect(staged(commands).filter((call) => call.op === 'put')).toHaveLength(3);
		expect(staged(commands).filter((call) => call.op === 'trigger')).toHaveLength(3);
		// The manifest went with the last object it listed.
		expect(commands.bucket().size).toBe(0);
		expect(output.trim()).toBe(
			'silent-video-validator-v1 acceptance passed checks=3 fixtures=3 cleaned=6',
		);
	});
});

describe('deployed validator acceptance: redacted failures', () => {
	it('names the failed step without the key, arguments or stderr, and still cleans up', async () => {
		const commands = fakeCommands({ failPut: true });
		const { exitCode } = await run(commands);

		expect(exitCode).toBe(1);
		expect(output).toContain(
			'silent-video-validator-v1 validator-command-failed fixture=h264Mp4 step=put exit=1',
		);
		expectSafe(output);
		// The source was recorded before its put, so cleanup tries it even though
		// the put's own outcome is unknown.
		expect(
			commands.calls.filter((call) => call.op === 'delete' && call.key !== MANIFEST_KEY),
		).toHaveLength(1);
		expect(manifestIn(commands)).toBeUndefined();
	});

	it('stages nothing it could not first record in the manifest', async () => {
		const commands = fakeCommands({ failManifestWrite: true });
		const { exitCode } = await run(commands);

		expect(exitCode).toBe(1);
		expect(output).toContain(
			'silent-video-validator-v1 validator-command-failed step=manifest exit=1',
		);
		expect(staged(commands)).toEqual([]);
		expectSafe(output);
	});

	it('reports an inexact acceptance by field, never by dumping the Workflow output', async () => {
		const commands = fakeCommands({ outcome: 'rejected' });
		await run(commands);

		expect(output).toContain(
			'silent-video-validator-v1 validator-output-unexpected fixture=h264Mp4 field=outcome',
		);
		expectSafe(output);
	});
});

describe('deployed validator acceptance: cleanup', () => {
	// The manifest is an object in the Installation's own staging bucket, so a
	// run on a CI runner that is gone leaves it to the next run, wherever it runs.
	it('fails a run whose deletion failed, and the next run, on another machine, removes what it left before staging more', async () => {
		const cloudflare: Cloudflare = new Map();
		const first = await run(fakeCommands({ failDeletes: 2 }, cloudflare));

		expect(first.exitCode).toBe(1);
		expect(output).toContain('silent-video-validator-v1 harness-cleanup-incomplete remaining=2');
		expect(output).not.toContain('acceptance passed');
		expectSafe(output);
		const left = manifestIn(fakeCommands({}, cloudflare));
		expect(left.target).toEqual({ accountId: ACCOUNT, stagingBucket: BUCKET, workflow: WORKFLOW });
		expect(left.objects).toHaveLength(2);

		output = '';
		const elsewhere = await mkdtemp(join(tmpdir(), 'validator-acceptance-elsewhere-'));
		const next = fakeCommands({}, cloudflare);
		try {
			expect((await run(next, { cacheDirectory: elsewhere })).exitCode).toBeUndefined();
		} finally {
			await rm(elsewhere, { recursive: true, force: true });
		}

		const leftKeys: string[] = left.objects.map(({ key }: { key: string }) => key);
		const deletesOfLeft = next.calls.filter(
			(call) => call.op === 'delete' && leftKeys.includes(call.key!),
		);
		expect(deletesOfLeft).toHaveLength(2);
		expect(next.calls.indexOf(deletesOfLeft.at(-1)!)).toBeLessThan(
			next.calls.indexOf(staged(next)[0]!),
		);
		expect(next.bucket().size).toBe(0);
		expect(output.trim()).toBe(
			'silent-video-validator-v1 acceptance passed checks=3 fixtures=3 cleaned=6 earlier=2',
		);
	});

	it('stages nothing while what an earlier run left cannot be deleted', async () => {
		const cloudflare: Cloudflare = new Map();
		await run(fakeCommands({ failDeletes: 2 }, cloudflare));
		output = '';

		const blocked = fakeCommands({ failDeletes: 2 }, cloudflare);
		expect((await run(blocked)).exitCode).toBe(1);
		expect(output).toContain('silent-video-validator-v1 harness-cleanup-pending remaining=2');
		expect(staged(blocked)).toEqual([]);
		expect(manifestIn(blocked).objects).toHaveLength(2);
		expectSafe(output);
	});

	it('retries the deletes alone, with no operator, and a second retry finds nothing', async () => {
		const cloudflare: Cloudflare = new Map();
		await run(fakeCommands({ failDeletes: 2 }, cloudflare));
		output = '';

		const retry = fakeCommands({}, cloudflare);
		// A retry signs in as nobody, so it does not need the operator.
		const retried = await run(retry, {
			env: { ...ENV, STREAM_KEEPR_ACCEPTANCE_OPERATOR_PASSWORD: undefined },
			flags: ['--deployed', '--cleanup'],
		});
		expect(retried.exitCode).toBeUndefined();
		expect(retry.bucket().size).toBe(0);
		expect(output.trim()).toBe('silent-video-validator-v1 acceptance passed checks=1 cleaned=2');

		output = '';
		const again = fakeCommands({}, cloudflare);
		expect((await run(again, { flags: ['--deployed', '--cleanup'] })).exitCode).toBeUndefined();
		expect(mutations(again)).toEqual([]);
		expect(output.trim()).toBe('silent-video-validator-v1 acceptance passed checks=1 cleaned=0');
	});

	it('keeps a poster listed while its Workflow has not settled, and a later retry clears it', async () => {
		const cloudflare: Cloudflare = new Map();
		const unsettled = fakeCommands({ neverSettle: true }, cloudflare);
		const first = await run(unsettled);

		expect(first.exitCode).toBe(1);
		expect(output).toContain('silent-video-validator-v1 validator-did-not-settle fixture=h264Mp4');
		// The source is gone; the poster the instance may still write is not forgotten.
		expect(output).toContain('silent-video-validator-v1 harness-cleanup-incomplete remaining=1');
		expect(manifestIn(unsettled).objects).toEqual([
			{
				key: expect.stringMatching(/^validation\/silent-video\//u),
				instance: expect.any(String),
			},
		]);
		expectSafe(output);

		output = '';
		const settled = fakeCommands({}, cloudflare);
		expect((await run(settled, { flags: ['--deployed', '--cleanup'] })).exitCode).toBeUndefined();
		expect(output.trim()).toBe('silent-video-validator-v1 acceptance passed checks=1 cleaned=1');
		expect(manifestIn(settled)).toBeUndefined();
	});

	it('treats a manifest that lists nothing as no manifest, so a run killed before its first write blocks nothing', async () => {
		const commands = fakeCommands();
		commands.bucket().set(
			MANIFEST_KEY,
			Buffer.from(
				JSON.stringify({
					version: 1,
					target: { accountId: ACCOUNT, stagingBucket: BUCKET, workflow: WORKFLOW },
					objects: [],
				}),
			),
		);

		expect((await run(commands)).exitCode).toBeUndefined();
		expect(manifestIn(commands)).toBeUndefined();
	});

	it('keeps what a retry could not delete, and deletes the rest', async () => {
		const cloudflare: Cloudflare = new Map();
		await run(fakeCommands({ failDeletes: 2 }, cloudflare));
		output = '';

		const retry = fakeCommands({ failDeletes: 1 }, cloudflare);
		const retried = await run(retry, { flags: ['--deployed', '--cleanup'] });

		expect(retried.exitCode).toBe(1);
		expect(output).toContain('harness-cleanup-incomplete remaining=1');
		expect(manifestIn(retry).objects).toHaveLength(1);
	});

	it('refuses to retry a manifest written for another Workflow', async () => {
		const commands = fakeCommands();
		commands.bucket().set(
			MANIFEST_KEY,
			Buffer.from(
				JSON.stringify({
					version: 1,
					target: { accountId: ACCOUNT, stagingBucket: BUCKET, workflow: 'another-workflow' },
					objects: [{ key: 'ingestion/left-behind/source' }],
				}),
			),
		);

		expect((await run(commands, { flags: ['--deployed', '--cleanup'] })).exitCode).toBe(1);
		expect(output).toContain('harness-target-inconsistent reason=manifest-target-mismatch');
		expect(mutations(commands)).toEqual([]);
		expectSafe(output);
	});
});

describe('deployed validator acceptance: one cleanup manifest per Installation', () => {
	const environments = { production: ENV, staging: STAGING_ENV };
	const accounts = { production: ACCOUNT, staging: STAGING_ACCOUNT };

	it.each([
		['production', 'staging'],
		['staging', 'production'],
	] as const)('a cleanup pending in %s does not block %s', async (left, next) => {
		const cloudflare: Cloudflare = new Map();
		expect(
			(await run(fakeCommands({ failDeletes: 1 }, cloudflare), { env: environments[left] }))
				.exitCode,
		).toBe(1);
		output = '';

		const commands = fakeCommands({}, cloudflare);
		expect((await run(commands, { env: environments[next] })).exitCode).toBeUndefined();
		expect(manifestIn(commands, accounts[left]).objects).toHaveLength(1);
	});

	/** A manifest a run kept on this machine, before the manifest moved into the Installation. */
	async function leaveLocalManifest(path: string, accountId = ACCOUNT) {
		await mkdir(dirname(path), { recursive: true });
		await writeFile(
			path,
			JSON.stringify({
				version: 1,
				target: { accountId, stagingBucket: BUCKET, workflow: WORKFLOW },
				objects: [{ key: 'ingestion/left-behind/source' }],
			}),
		);
		return path;
	}

	it.each([
		['staging', 'its Environment', 'staging/silent-video-validator-cleanup.json'],
		['production', 'the time before Environments', 'silent-video-validator-cleanup.json'],
	] as const)(
		'cleans what a %s run left listed on this machine in %s',
		async (environment, _, path) => {
			const local = await leaveLocalManifest(join(workspace, path), accounts[environment]);
			const commands = fakeCommands();

			expect((await run(commands, { env: environments[environment] })).exitCode).toBeUndefined();
			expect(
				commands.calls.some(
					(call) => call.op === 'delete' && call.key === 'ingestion/left-behind/source',
				),
			).toBe(true);
			expect(output.trim()).toContain('earlier=1');
			expect(existsSync(local)).toBe(false);
		},
	);

	it("leaves production's pending cleanup from before Environments to production", async () => {
		const unscoped = await leaveLocalManifest(
			join(workspace, 'silent-video-validator-cleanup.json'),
		);

		expect((await run(fakeCommands(), { env: STAGING_ENV })).exitCode).toBeUndefined();
		expect(existsSync(unscoped)).toBe(true);
	});
});
