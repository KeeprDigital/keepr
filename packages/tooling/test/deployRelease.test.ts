import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { deployableApps, readRelease, workerSourceConfig } from '../scripts/deploy/release.mjs';
import { ignoredPackages, versionedApps, workspacePackages } from '../scripts/versioned-apps.mjs';

const STREAM_DESCRIPTOR = {
	app: 'stream',
	build: ['build', 'worker:dry-run', 'worker:smoke'],
	output: '.output',
	worker: {
		source: 'wrangler.jsonc',
		config: '.output/server/wrangler.json',
		secrets: [
			'NUXT_BETTER_AUTH_SECRET',
			'NUXT_GRAPHICS_ADMIN_TOKEN',
			'NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY',
			'NUXT_ABLY_API_KEY',
			'NUXT_MELEE_CREDENTIAL_ENCRYPTION_KEY',
			'NUXT_MELEE_CREDENTIAL_ENCRYPTION_KEY_VERSION',
		],
	},
	databases: [{ binding: 'DB' }],
	environments: { production: { url: 'https://stream.keepr.digital' } },
	parts: {
		validator: {
			config: 'workers/silent-video-validator/wrangler.jsonc',
			container: 'workers/silent-video-validator/container',
		},
	},
};

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A Release checkout: the workspace's root and the files given, by path from it. */
function checkout(files: Record<string, unknown>) {
	const root = mkdtempSync(join(tmpdir(), 'keepr-release-'));
	roots.push(root);
	for (const [path, content] of Object.entries({
		'pnpm-workspace.yaml': 'packages: []\n',
		...files,
	})) {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(
			join(root, path),
			typeof content === 'string' ? content : JSON.stringify(content),
		);
	}
	return root;
}

const stream = (descriptor?: unknown, version = '1.8.0') => ({
	'apps/stream/package.json': { name: '@keepr/stream', version },
	...(descriptor === undefined ? {} : { 'apps/stream/deploy.jsonc': descriptor }),
});

describe("reading the Release's deploy descriptor", () => {
	it('reads the app, its directory, its version and its descriptor, and verifies by release identity', () => {
		const root = checkout(stream(STREAM_DESCRIPTOR));

		expect(readRelease({ root, app: 'stream' })).toEqual({
			app: 'stream',
			appDir: join(root, 'apps/stream'),
			version: '1.8.0',
			descriptor: STREAM_DESCRIPTOR,
			verifies: 'release',
		});
	});

	it('reads a descriptor written with comments', () => {
		const root = checkout(
			stream(
				`// Stream Keepr\n${JSON.stringify(STREAM_DESCRIPTOR, null, '\t').replace(/}$/, ',}')}`,
			),
		);

		expect(readRelease({ root, app: 'stream' }).descriptor).toEqual(STREAM_DESCRIPTOR);
	});

	// `@keepr/stream@1.6.0` and `1.7.0` predate descriptors and `/api/release`,
	// and a rollback still deploys them.
	it('deploys a Stream Keepr Release from before descriptors as Stream Keepr was deployed, checked for liveness only', () => {
		const root = checkout(stream(undefined, '1.6.0'));

		expect(readRelease({ root, app: 'stream' })).toMatchObject({
			app: 'stream',
			version: '1.6.0',
			descriptor: STREAM_DESCRIPTOR,
			verifies: 'liveness',
		});
	});

	it.each([
		[
			'an app with no descriptor',
			{ 'apps/score/package.json': { name: '@keepr/score', version: '0.0.0' } },
			'score',
			/score.*not deployable/,
		],
		[
			'an app the Release does not have',
			stream(STREAM_DESCRIPTOR),
			'accounts',
			/accounts.*not deployable/,
		],
	])('refuses %s', (_case, files, app, message) => {
		expect(() => readRelease({ root: checkout(files), app })).toThrow(message);
	});

	it.each([
		['another app named in it', { ...STREAM_DESCRIPTOR, app: 'score' }, /app "score"/],
		[
			'an Environment URL that is not http(s)',
			{ ...STREAM_DESCRIPTOR, environments: { production: { url: 'stream.keepr.digital' } } },
			/production.*url/,
		],
		['no Environment', { ...STREAM_DESCRIPTOR, environments: {} }, /environments/],
		[
			'a Worker without a built configuration',
			{ ...STREAM_DESCRIPTOR, worker: { source: 'wrangler.jsonc' } },
			/worker\.config/,
		],
		[
			'a Worker without a source configuration',
			{ ...STREAM_DESCRIPTOR, worker: { config: '.output/server/wrangler.json' } },
			/worker\.source/,
		],
		['a D1 database without a binding', { ...STREAM_DESCRIPTOR, databases: [{}] }, /databases/],
		[
			'a part name a marker cannot carry',
			{ ...STREAM_DESCRIPTOR, parts: { 'silent-video': STREAM_DESCRIPTOR.parts.validator } },
			/silent-video/,
		],
		[
			'a build step that is not a script name',
			{ ...STREAM_DESCRIPTOR, build: ['pnpm build'] },
			/build/,
		],
		[
			'an unattended gate that is not a script name',
			{ ...STREAM_DESCRIPTOR, gates: ['accept still-images --deployed'] },
			/gates/,
		],
		[
			'Worker secrets that are not a list',
			{ ...STREAM_DESCRIPTOR, worker: { ...STREAM_DESCRIPTOR.worker, secrets: 'NUXT_KEY' } },
			/worker\.secrets/,
		],
		[
			'a Worker secret that is not a name',
			{ ...STREAM_DESCRIPTOR, worker: { ...STREAM_DESCRIPTOR.worker, secrets: ['NUXT KEY'] } },
			/worker\.secrets/,
		],
		[
			"a part's secret that is not a name",
			{
				...STREAM_DESCRIPTOR,
				parts: { validator: { ...STREAM_DESCRIPTOR.parts.validator, secrets: [''] } },
			},
			/parts\.validator\.secrets/,
		],
	])('refuses a descriptor with %s', (_case, descriptor, message) => {
		expect(() => readRelease({ root: checkout(stream(descriptor)), app: 'stream' })).toThrow(
			message,
		);
	});

	it('refuses a Release whose app has no version to name', () => {
		const root = checkout({
			'apps/stream/package.json': { name: '@keepr/stream' },
			'apps/stream/deploy.jsonc': STREAM_DESCRIPTOR,
		});

		expect(() => readRelease({ root, app: 'stream' })).toThrow(/version/);
	});
});

// The Accounts Stand-in signs every request in as a Keepr Administrator: deployed,
// it would replace Keepr Accounts and admit anyone (ADR-0113, #1228 gap 6).
describe('the Accounts Stand-in never deploys', () => {
	const STAND_IN = {
		'packages/accounts-stand-in/package.json': {
			name: '@keepr/accounts-stand-in',
			keepr: { undeployable: 'the Accounts Stand-in admits anyone.' },
		},
	};
	const intoStandIn = '../../packages/accounts-stand-in/stand-in.wrangler.jsonc';

	it.each([
		[
			'as the Worker',
			{ ...STREAM_DESCRIPTOR, worker: { source: 'wrangler.jsonc', config: intoStandIn } },
		],
		[
			"as the Worker's source",
			{
				...STREAM_DESCRIPTOR,
				worker: { source: intoStandIn, config: '.output/server/wrangler.json' },
			},
		],
		['as a part', { ...STREAM_DESCRIPTOR, parts: { validator: { config: intoStandIn } } }],
	])('refuses a descriptor that would deploy it %s, in any Environment', (_case, descriptor) => {
		const root = checkout({ ...STAND_IN, ...stream(descriptor) });

		expect(() => readRelease({ root, app: 'stream' })).toThrow(/admits anyone/);
	});

	it('refuses an app that is itself marked undeployable', () => {
		const root = checkout({
			'apps/accounts/package.json': {
				name: '@keepr/accounts',
				version: '0.1.0',
				keepr: { undeployable: 'the Accounts Stand-in admits anyone.' },
			},
			'apps/accounts/deploy.jsonc': { ...STREAM_DESCRIPTOR, app: 'accounts', parts: {} },
		});

		expect(() => readRelease({ root, app: 'accounts' })).toThrow(/admits anyone/);
	});
});

// What CI's scope reads before anything is built (ADR-0121).
describe("an app's Worker source configuration", () => {
	it('is the one its descriptor names', () => {
		const root = checkout({ 'apps/stream/deploy.jsonc': { worker: { source: 'worker.jsonc' } } });

		expect(workerSourceConfig(root, 'stream')).toBe(join(root, 'apps/stream/worker.jsonc'));
	});

	it('is refused when its descriptor names none', () => {
		const root = checkout({ 'apps/stream/deploy.jsonc': { worker: {} } });

		expect(() => workerSourceConfig(root, 'stream')).toThrow(/worker\.source/);
	});
});

describe('which apps are deployable', () => {
	it('is the apps whose directory holds a descriptor', () => {
		const root = checkout({
			...stream(STREAM_DESCRIPTOR),
			'apps/score/package.json': { name: '@keepr/score' },
		});

		expect(deployableApps(root)).toEqual(['stream']);
	});

	// Changesets versions an app only when it can deploy it (ADR-0118): its ignore
	// list is kept by hand, and this keeps it in step with the descriptors.
	it('is, in this workspace, the apps Changesets versions', () => {
		const root = join(import.meta.dirname, '../../..');
		const versioned = versionedApps(workspacePackages(root), ignoredPackages(root)).map(
			(app: { name: string }) => app.name.replace(/^@keepr\//, ''),
		);

		expect(deployableApps(root).toSorted()).toEqual(versioned.toSorted());
	});

	it("reads each of this workspace's descriptors", () => {
		const root = join(import.meta.dirname, '../../..');

		for (const app of deployableApps(root))
			expect(readRelease({ root, app }), app).toMatchObject({ app, verifies: 'release' });
	});

	// A missing script fails the build job, or the staging job's gates, not review.
	it("names, in each of this workspace's descriptors, only scripts its app has", () => {
		const root = join(import.meta.dirname, '../../..');

		for (const app of deployableApps(root)) {
			const { appDir, descriptor } = readRelease({ root, app });
			const scripts = Object.keys(
				(
					JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8')) as {
						scripts: Record<string, string>;
					}
				).scripts,
			);
			for (const script of [...descriptor.build, ...(descriptor.gates ?? [])])
				expect(scripts, `${app}: ${script}`).toContain(script);
		}
	});
});
