import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { MarkerStore } from '../scripts/deploy/markers.mjs';
import { parseMarker } from '../scripts/deploy/markers.mjs';
import type { Descriptor, Release } from '../scripts/deploy/release.mjs';
import {
	decidePartDeploy,
	deployRelease,
	markApp,
	promotePart,
} from '../scripts/deploy/procedure.mjs';
import { verifyInstallation } from '../scripts/deploy/verify.mjs';

const FINGERPRINT_A = `sha256:${'a'.repeat(64)}`;
const FINGERPRINT_B = `sha256:${'b'.repeat(64)}`;
const COMMIT_A = '1'.repeat(40);

/** A part's marker as an annotated tag's message carries it, written out by hand. */
function deployedMarker(fingerprint: string, commit = COMMIT_A) {
	return [
		'stream-keepr promotion marker',
		'',
		'component: validator',
		'state: deployed',
		`commit: ${commit}`,
		'worktree: clean',
		`fingerprint: ${fingerprint}`,
		'source: local',
		'',
	].join('\n');
}

describe('deciding whether a part deploys', () => {
	const decide = (input: {
		mode?: 'auto' | 'always' | 'never';
		targetFingerprint: string | undefined;
		markerText: string | undefined;
	}) =>
		decidePartDeploy({
			mode: 'auto',
			part: 'validator',
			marker: 'stream/production-validator',
			...input,
		});

	it('deploys when no marker exists', () => {
		const decision = decide({ targetFingerprint: FINGERPRINT_A, markerText: undefined });

		expect(decision.deploy).toBe(true);
		expect(decision.reason).toMatch(/no stream\/production-validator marker/);
	});

	it('skips when the deployed part has the target fingerprint', () => {
		const decision = decide({
			targetFingerprint: FINGERPRINT_A,
			markerText: deployedMarker(FINGERPRINT_A),
		});

		expect(decision.deploy).toBe(false);
		expect(decision.reason).toContain('unchanged');
		expect(decision.reason).toContain(COMMIT_A);
	});

	it('deploys when the target fingerprint differs from the deployed one', () => {
		const decision = decide({
			targetFingerprint: FINGERPRINT_B,
			markerText: deployedMarker(FINGERPRINT_A),
		});

		expect(decision.deploy).toBe(true);
		expect(decision.reason).toMatch(/\bchanged\b/);
	});

	it.each([
		['an empty message (a lightweight tag)', ''],
		[
			"another component's marker",
			deployedMarker(FINGERPRINT_A).replace('component: validator', 'component: app'),
		],
		[
			'an unknown state',
			deployedMarker(FINGERPRINT_A).replace('state: deployed', 'state: rolled-back'),
		],
		['an unknown fingerprint', deployedMarker('unknown')],
		['a fingerprint of an unknown scheme', deployedMarker(`md5:${'a'.repeat(32)}`)],
	])('deploys when the marker is unreadable: %s', (_case, markerText) => {
		const decision = decide({ targetFingerprint: FINGERPRINT_A, markerText });

		expect(decision.deploy).toBe(true);
		expect(decision.reason).toMatch(/unreadable|unknown/);
	});

	it('deploys when the last deploy was started but never confirmed, even at the target fingerprint', () => {
		const decision = decide({
			targetFingerprint: FINGERPRINT_A,
			markerText: deployedMarker(FINGERPRINT_A).replace('state: deployed', 'state: pending'),
		});

		expect(decision.deploy).toBe(true);
		expect(decision.reason).toContain('never confirmed');
	});

	it.each([
		['always', FINGERPRINT_A, deployedMarker(FINGERPRINT_A), true],
		['never', FINGERPRINT_B, undefined, false],
	] as const)(
		'the %s mode overrides the markers',
		(mode, targetFingerprint, markerText, deploy) => {
			expect(decide({ mode, targetFingerprint, markerText }).deploy).toBe(deploy);
		},
	);

	it('refuses an unknown mode rather than guessing', () => {
		expect(() =>
			decide({
				mode: 'sometimes' as 'auto',
				targetFingerprint: FINGERPRINT_A,
				markerText: undefined,
			}),
		).toThrow(/sometimes/);
	});

	it('deploys when the target could not be fingerprinted', () => {
		const decision = decide({
			targetFingerprint: undefined,
			markerText: deployedMarker(FINGERPRINT_A),
		});

		expect(decision.deploy).toBe(true);
		expect(decision.reason).toContain('could not be fingerprinted');
	});
});

const DESCRIPTOR: Descriptor = {
	app: 'stream',
	build: ['build', 'worker:dry-run', 'worker:smoke'],
	output: '.output',
	worker: {
		source: 'wrangler.jsonc',
		config: '.output/server/wrangler.json',
		secrets: ['NUXT_BETTER_AUTH_SECRET'],
	},
	databases: [{ binding: 'DB' }],
	environments: {
		production: { url: 'https://stream.keepr.digital' },
		staging: { url: 'https://stream.staging.keepr.digital', wranglerEnv: 'staging' },
	},
	parts: {
		validator: {
			config: 'workers/silent-video-validator/wrangler.jsonc',
			container: 'workers/silent-video-validator/container',
		},
	},
};

interface Snapshot {
	commit: string;
	version: string;
	/** What `fingerprintPart` answers for the validator in this Release's checkout. */
	validator: string;
	/** `liveness` for a Release from before `/api/release`. */
	verifies?: Release['verifies'];
}

const A: Snapshot = { commit: 'a'.repeat(40), version: '1.8.0', validator: FINGERPRINT_A };
const A_PATCH: Snapshot = { commit: 'c'.repeat(40), version: '1.8.1', validator: FINGERPRINT_A };
const B: Snapshot = { commit: 'b'.repeat(40), version: '1.9.0', validator: FINGERPRINT_B };
const C: Snapshot = {
	commit: 'd'.repeat(40),
	version: '1.9.1',
	validator: `sha256:${'d'.repeat(64)}`,
};
/** `@keepr/stream@1.6.0`: no descriptor, no `/api/release`. */
const V1_6_0: Snapshot = {
	commit: 'e'.repeat(40),
	version: '1.6.0',
	validator: `sha256:${'e'.repeat(64)}`,
	verifies: 'liveness',
};

type Failure = 'build' | 'validator' | 'migrate' | 'worker' | 'stale';
type Environment = 'production' | 'staging';

function quiet() {}

/**
 * Cloudflare and the marker remote, both in memory. The steps stand in for
 * `pnpm run build`, `wrangler deploy` and `wrangler d1 migrations apply`: they
 * move what an Installation runs, or fail without moving it. Each Installation
 * answers `/api/release` and `/api/time` for the Worker it runs, and the
 * procedure's verify asks it through the real `verifyInstallation`. Nothing
 * here spawns a process or opens a socket.
 */
function world() {
	const tags = new Map<string, { commit: string; message: string }>();
	const installations: Record<
		Environment,
		{ worker?: Snapshot; validator?: string; migrated?: string; secrets: string[] }
	> = {
		production: { secrets: ['NUXT_BETTER_AUTH_SECRET'] },
		staging: { secrets: ['NUXT_BETTER_AUTH_SECRET'] },
	};
	const artifacts = new Map<string, Snapshot>();
	const ran: string[] = [];
	let checkout: Snapshot = A;
	let dirty = false;
	let output: Snapshot | undefined;
	const store: MarkerStore = {
		head: () => checkout.commit,
		dirty: () => dirty,
		read: (name) => tags.get(name)?.message,
		write: (name, commit, message) => {
			ran.push(`marker ${name}`);
			tags.set(name, { commit, message });
		},
		remove: (name) => {
			tags.delete(name);
		},
		names: () => [...tags.keys()],
	};

	function release(snapshot: Snapshot): Release {
		return {
			app: 'stream',
			appDir: '/release/apps/stream',
			version: snapshot.version,
			descriptor: DESCRIPTOR,
			verifies: snapshot.verifies ?? 'release',
		};
	}

	function fetchFrom(environment: Environment) {
		return (async (input: string | URL | Request) => {
			const serving = installations[environment].worker;
			const path = new URL(String(input)).pathname;
			const json = (body: unknown) =>
				new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
			if (serving && path === '/api/time') return json({ serverTime: 1_760_000_000_000 });
			if (serving && path === '/api/release' && serving.verifies !== 'liveness')
				return json({ app: 'stream', version: serving.version, commit: serving.commit });
			return new Response('Not Found', { status: 404 });
		}) as typeof fetch;
	}

	function steps(snapshot: Snapshot, environment: Environment, fail?: Failure) {
		const installation = installations[environment];
		return {
			build: () => {
				ran.push('build');
				if (fail === 'build') throw new Error('nuxt build failed');
				output = checkout;
			},
			placeArtifact: (path: string) => {
				ran.push(`artifact ${path}`);
				output = artifacts.get(path);
			},
			fingerprint: () => snapshot.validator,
			secretNames: () => installation.secrets,
			configuredVars: () => ({}),
			deployPart: (part: string) => {
				ran.push(`deploy ${part}`);
				if (fail === 'validator') throw new Error('wrangler deploy failed');
				installation.validator = snapshot.validator;
			},
			migrate: (binding: string) => {
				ran.push(`migrate ${binding}`);
				if (fail === 'migrate') throw new Error('wrangler d1 migrations apply failed');
				installation.migrated = snapshot.commit;
			},
			deployWorker: () => {
				ran.push('deploy worker');
				if (fail === 'worker') throw new Error('wrangler deploy failed');
				// `stale`: wrangler reports success, and the previous Worker keeps answering.
				if (fail !== 'stale' && output) installation.worker = output;
			},
			verify: () =>
				verifyInstallation({
					release: release(snapshot),
					environment,
					commit: store.head(),
					env: {},
					fetchRequest: fetchFrom(environment),
					log: quiet,
					attempts: 1,
				}),
		};
	}

	function checkOut(snapshot: Snapshot, options: { dirty?: boolean } = {}) {
		checkout = snapshot;
		dirty = options.dirty ?? false;
	}

	/** One deploy of `snapshot`, the Deploy workflow's by default. */
	function deploy(
		snapshot: Snapshot,
		options: {
			mode?: 'auto' | 'always' | 'never';
			fail?: Failure;
			environment?: Environment;
			artifact?: string;
			source?: string;
			dirty?: boolean;
			beforeRemoteChange?: Parameters<typeof deployRelease>[0]['beforeRemoteChange'];
		} = {},
	) {
		checkOut(snapshot, { dirty: options.dirty ?? false });
		output = undefined;
		ran.length = 0;
		const environment = options.environment ?? 'production';
		return deployRelease({
			release: release(snapshot),
			environment,
			store,
			steps: steps(snapshot, environment, options.fail),
			mode: options.mode ?? 'auto',
			source: options.source ?? 'actions',
			log: quiet,
			...(options.artifact === undefined ? {} : { artifact: options.artifact }),
			...(options.beforeRemoteChange ? { beforeRemoteChange: options.beforeRemoteChange } : {}),
		});
	}

	function marker(name: string) {
		const tag = tags.get(name);
		return tag && { tagged: tag.commit, ...parseMarker(tag.message) };
	}

	return { store, tags, installations, artifacts, ran, release, steps, checkOut, deploy, marker };
}

const production = (w: ReturnType<typeof world>) => ({
	worker: w.installations.production.worker?.commit,
	validator: w.installations.production.validator,
});

describe('deploying a Release to an Environment', () => {
	it('a first deploy with no markers builds, deploys and records the app and its validator', async () => {
		const w = world();

		const result = await w.deploy(A);

		expect(result.parts.validator!.deploy).toBe(true);
		expect(production(w)).toEqual({ worker: A.commit, validator: A.validator });
		expect(w.installations.production.migrated).toBe(A.commit);
		expect(w.marker('stream/production-validator')).toEqual({
			tagged: A.commit,
			component: 'validator',
			state: 'deployed',
			commit: A.commit,
			worktree: 'clean',
			fingerprint: A.validator,
			source: 'actions',
			app: 'stream',
			environment: 'production',
			version: A.version,
		});
		expect(w.marker('stream/production')).toEqual({
			tagged: A.commit,
			component: 'app',
			state: 'deployed',
			commit: A.commit,
			worktree: 'clean',
			source: 'actions',
			app: 'stream',
			environment: 'production',
			version: A.version,
		});
	});

	it('builds once, then marks pending before the first remote change and deployed after verify', async () => {
		const w = world();

		await w.deploy(A);

		expect(w.ran).toEqual([
			'build',
			'marker stream/production-validator',
			'deploy validator',
			'marker stream/production-validator',
			'marker stream/production',
			'migrate DB',
			'deploy worker',
			'marker stream/production',
		]);
	});

	it('skips the validator when its build inputs are unchanged, and leaves its marker on the Release that deployed it', async () => {
		const w = world();
		await w.deploy(A);

		const result = await w.deploy(A_PATCH);

		expect(result.parts.validator!.deploy).toBe(false);
		expect(production(w)).toEqual({ worker: A_PATCH.commit, validator: A.validator });
		expect(w.marker('stream/production-validator')).toMatchObject({
			commit: A.commit,
			state: 'deployed',
		});
		expect(w.marker('stream/production')).toMatchObject({
			commit: A_PATCH.commit,
			state: 'deployed',
		});
	});

	it.each([
		['the D1 migration', 'migrate', /migrations apply failed/],
		['the Worker deploy', 'worker', /wrangler deploy failed/],
		[
			'verify, while the previous Worker still answers',
			'stale',
			/names stream@1\.8\.0.*not the Release just deployed/,
		],
	] as const)(
		'records a partial deploy (validator B deployed, %s failed) as exactly that',
		async (_case, fail, message) => {
			const w = world();
			await w.deploy(A);

			await expect(w.deploy(B, { fail })).rejects.toThrow(message);

			expect(w.installations.production.validator).toBe(B.validator);
			expect(w.marker('stream/production-validator')).toMatchObject({
				commit: B.commit,
				state: 'deployed',
			});
			// A failure between the app's markers may leave A or B serving: unconfirmed, never claimed.
			expect(w.marker('stream/production')).toMatchObject({ commit: B.commit, state: 'pending' });
		},
	);

	it("rolling back to A after a partial deploy restores A's validator as well as A's app", async () => {
		const w = world();
		await w.deploy(A);
		await expect(w.deploy(B, { fail: 'worker' })).rejects.toThrow();

		const result = await w.deploy(A);

		expect(result.parts.validator!.deploy).toBe(true);
		expect(production(w)).toEqual({ worker: A.commit, validator: A.validator });
		expect(w.marker('stream/production')).toMatchObject({ commit: A.commit, state: 'deployed' });
	});

	it('rolls back to @keepr/stream@1.6.0, which predates /api/release, checked for liveness only', async () => {
		const w = world();
		await w.deploy(B);

		const result = await w.deploy(V1_6_0);

		expect(result.verified).toBe('liveness');
		expect(production(w)).toEqual({ worker: V1_6_0.commit, validator: V1_6_0.validator });
		expect(w.marker('stream/production')).toMatchObject({
			commit: V1_6_0.commit,
			state: 'deployed',
			version: '1.6.0',
		});
	});

	it('a failed validator deploy stops before the app and leaves its marker pending, so the next deploy redeploys it', async () => {
		const w = world();
		await w.deploy(A);

		await expect(w.deploy(B, { fail: 'validator' })).rejects.toThrow(/wrangler deploy failed/);

		expect(production(w)).toEqual({ worker: A.commit, validator: A.validator });
		expect(w.marker('stream/production-validator')).toMatchObject({
			commit: B.commit,
			state: 'pending',
		});
		expect(w.marker('stream/production')).toMatchObject({ commit: A.commit, state: 'deployed' });
		// Even back at A's fingerprint, an unconfirmed deploy is not trusted.
		expect((await w.deploy(A)).parts.validator!.deploy).toBe(true);
	});

	it('a failed build changes nothing remote', async () => {
		const w = world();
		await w.deploy(A);
		const tags = new Map(w.tags);

		await expect(w.deploy(B, { fail: 'build' })).rejects.toThrow(/nuxt build failed/);

		expect(production(w)).toEqual({ worker: A.commit, validator: A.validator });
		expect(w.tags).toEqual(tags);
	});

	it('an emergency local deploy from a dirty checkout records it, so the next deploy sees what runs', async () => {
		const w = world();
		await w.deploy(B);

		await w.deploy(C, { source: 'local', dirty: true });

		for (const name of ['stream/production', 'stream/production-validator'])
			expect(w.marker(name)).toMatchObject({
				commit: C.commit,
				state: 'deployed',
				worktree: 'dirty',
				source: 'local',
			});
		expect((await w.deploy(B)).parts.validator!.deploy).toBe(true);
		expect(production(w)).toEqual({ worker: B.commit, validator: B.validator });
	});

	it('the never mode leaves the validator and its marker alone', async () => {
		const w = world();
		await w.deploy(A);

		const result = await w.deploy(B, { mode: 'never' });

		expect(result.parts.validator!.deploy).toBe(false);
		expect(production(w)).toEqual({ worker: B.commit, validator: A.validator });
		expect(w.marker('stream/production-validator')).toMatchObject({ commit: A.commit });
	});

	it("deploys to one Environment without touching another's Installation or markers", async () => {
		const w = world();
		await w.deploy(A);

		await w.deploy(B, { environment: 'staging' });

		expect(production(w)).toEqual({ worker: A.commit, validator: A.validator });
		expect(w.installations.staging.worker?.commit).toBe(B.commit);
		expect(w.marker('stream/production')).toMatchObject({ commit: A.commit });
		expect(w.marker('stream/staging')).toMatchObject({
			commit: B.commit,
			state: 'deployed',
			environment: 'staging',
		});
		expect(w.marker('stream/staging-validator')).toMatchObject({ commit: B.commit });
	});

	it('refuses an Environment the descriptor has no Installation in, before building', async () => {
		const w = world();

		await expect(w.deploy(A, { environment: 'preview' as Environment })).rejects.toThrow(
			/no Installation in preview/,
		);
		expect(w.ran).toEqual([]);
	});

	// Build once (#525 d): one build job's output is what every Environment deploys.
	describe('a downloaded artifact', () => {
		it('deploys the artifact instead of building', async () => {
			const w = world();
			w.artifacts.set('/downloads/stream-output', B);

			await w.deploy(B, { artifact: '/downloads/stream-output' });

			expect(w.ran).not.toContain('build');
			expect(w.ran[0]).toBe('artifact /downloads/stream-output');
			expect(w.installations.production.worker?.commit).toBe(B.commit);
			expect(w.marker('stream/production')).toMatchObject({ commit: B.commit, state: 'deployed' });
		});

		it("is caught by verify when it is not the Release's build", async () => {
			const w = world();
			w.artifacts.set('/downloads/stream-output', A);

			await expect(w.deploy(B, { artifact: '/downloads/stream-output' })).rejects.toThrow(
				/names stream@1\.8\.0/,
			);
			expect(w.marker('stream/production')).toMatchObject({ commit: B.commit, state: 'pending' });
		});
	});

	// Deploy order between apps (#1263) refuses here: after the build, before anything remote.
	describe('the check before the first remote change', () => {
		it('runs after the build and before any marker or Cloudflare change, knowing what is deployed where', async () => {
			const w = world();
			const seen: unknown[] = [];

			await w.deploy(A, {
				beforeRemoteChange: (context) => {
					seen.push({
						app: context.release.app,
						environment: context.environment,
						version: context.release.version,
						ranBefore: [...w.ran],
					});
				},
			});

			expect(seen).toEqual([
				{ app: 'stream', environment: 'production', version: A.version, ranBefore: ['build'] },
			]);
		});

		it('refusing leaves every Installation and marker as it was', async () => {
			const w = world();
			await w.deploy(A);
			const tags = new Map(w.tags);

			await expect(
				w.deploy(B, {
					beforeRemoteChange: () => {
						throw new Error('accounts/production is older than stream needs');
					},
				}),
			).rejects.toThrow(/older than stream needs/);

			expect(production(w)).toEqual({ worker: A.commit, validator: A.validator });
			expect(w.tags).toEqual(tags);
		});

		it("records what it answers in the app's markers, pending and deployed, and not the parts'", async () => {
			const w = world();
			const pending: unknown[] = [];
			const steps = w.steps(A, 'production');
			const recorded = { needs: 'accounts', override: 'Keepr Accounts is down; #1300' };

			await deployRelease({
				release: w.release(A),
				environment: 'production',
				store: w.store,
				steps: {
					...steps,
					deployWorker: () => {
						pending.push(w.marker('stream/production'));
						steps.deployWorker();
					},
				},
				source: 'actions',
				log: quiet,
				beforeRemoteChange: () => recorded,
			});

			expect(pending).toEqual([expect.objectContaining({ state: 'pending', ...recorded })]);
			expect(w.marker('stream/production')).toMatchObject({ state: 'deployed', ...recorded });
			expect(w.marker('stream/production-validator')).not.toHaveProperty('needs');
		});
	});

	// A Worker with no secrets passes every gate and still answers sign-in 503.
	it('refuses an Installation missing a required Worker secret before migrating D1 or deploying a part', async () => {
		const w = world();
		await w.deploy(A, { environment: 'staging' });
		const tags = new Map(w.tags);
		w.installations.staging.secrets = [];

		await expect(w.deploy(B, { environment: 'staging' })).rejects.toThrow(
			/stream's Worker lacks NUXT_BETTER_AUTH_SECRET/,
		);

		expect(w.ran).toEqual(['build']);
		expect(w.installations.staging).toMatchObject({ worker: A, validator: A.validator });
		expect(w.tags).toEqual(tags);
	});

	// The Accounts Stand-in never deploys (ADR-0113): what a build or an artifact
	// leaves to upload is guarded too, not only the configurations the descriptor names.
	describe('the Accounts Stand-in never deploys', () => {
		const MARKED = { keepr: { undeployable: 'the Accounts Stand-in admits anyone.' } };
		const appDirs: string[] = [];
		afterEach(() => {
			for (const dir of appDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
		});

		it.each([
			['the Worker it built', '.output/server/package.json', {}],
			[
				'the Worker an artifact placed',
				'.output/server/package.json',
				{ artifact: '/downloads/stream-output' },
			],
			['a part, once built', 'workers/silent-video-validator/package.json', {}],
		])(
			'refuses %s under a package marked undeployable, with nothing remote touched',
			async (_case, marked, options) => {
				const w = world();
				const appDir = mkdtempSync(join(tmpdir(), 'keepr-procedure-'));
				appDirs.push(appDir);
				const steps = w.steps(B, 'production');
				const leaveMarked = () => {
					mkdirSync(dirname(join(appDir, marked)), { recursive: true });
					writeFileSync(join(appDir, marked), JSON.stringify(MARKED));
				};

				await expect(
					deployRelease({
						release: { ...w.release(B), appDir },
						environment: 'production',
						store: w.store,
						steps: {
							...steps,
							build: () => {
								steps.build();
								leaveMarked();
							},
							placeArtifact: (path) => {
								steps.placeArtifact(path);
								leaveMarked();
							},
						},
						source: 'actions',
						log: quiet,
						...options,
					}),
				).rejects.toThrow(/admits anyone/);

				expect(w.ran).toEqual([
					'artifact' in options ? 'artifact /downloads/stream-output' : 'build',
				]);
				expect(w.tags.size).toBe(0);
			},
		);
	});

	// ADR-0119 renames `production` and `production-validator`; the first deploy
	// under the new names redeploys the validator once and retires the old tags.
	describe('the markers from before per-app names', () => {
		function withLegacyMarkers() {
			const w = world();
			w.tags.set('production', {
				commit: A.commit,
				message: deployedMarker(A.validator, A.commit).replace(
					'component: validator',
					'component: app',
				),
			});
			w.tags.set('production-validator', {
				commit: A.commit,
				message: deployedMarker(A.validator),
			});
			return w;
		}

		it('are not read: the first deploy under the new names redeploys the validator once', async () => {
			const w = withLegacyMarkers();

			expect((await w.deploy(A)).parts.validator!.deploy).toBe(true);
			expect((await w.deploy(A_PATCH)).parts.validator!.deploy).toBe(false);
		});

		it('are removed once their replacements record a confirmed deploy', async () => {
			const w = withLegacyMarkers();

			const result = await w.deploy(A);

			expect(result.retired).toEqual(['production', 'production-validator']);
			expect([...w.tags.keys()].toSorted()).toEqual([
				'stream/production',
				'stream/production-validator',
			]);
		});

		it.each([
			['a failed deploy', { fail: 'worker' as const }, ['production', 'production-validator']],
			[
				'a deploy that left the validator alone',
				{ mode: 'never' as const },
				['production-validator'],
			],
		])('outlive %s whose replacement is unconfirmed', async (_case, options, kept) => {
			const w = withLegacyMarkers();

			await w.deploy(A, options).catch(() => {});

			expect(kept.every((name) => w.tags.has(name))).toBe(true);
		});
	});
});

describe('deploying one part, or marking the app, by hand', () => {
	const RELEASE: Release = {
		app: 'stream',
		appDir: '/release/apps/stream',
		version: A.version,
		descriptor: DESCRIPTOR,
		verifies: 'release',
	};

	it('never deploys a part when its pending marker cannot be written', () => {
		const w = world();
		let deployed = false;

		expect(() =>
			promotePart({
				store: {
					...w.store,
					write: () => {
						throw new Error('marker write refused');
					},
				},
				release: RELEASE,
				environment: 'production',
				part: 'validator',
				fingerprint: () => A.validator,
				deploy: () => {
					deployed = true;
				},
				source: 'local',
			}),
		).toThrow(/marker write refused/);
		expect(deployed).toBe(false);
	});

	it('records an unknown fingerprint when the checkout cannot be fingerprinted, so the next deploy redeploys', async () => {
		const w = world();

		promotePart({
			store: w.store,
			release: RELEASE,
			environment: 'production',
			part: 'validator',
			fingerprint: () => {
				throw new Error('could not bundle the validator');
			},
			deploy: () => {},
			source: 'local',
			log: quiet,
		});

		expect(w.marker('stream/production-validator')).toMatchObject({
			state: 'deployed',
			fingerprint: 'unknown',
		});
		expect((await w.deploy(A)).parts.validator!.deploy).toBe(true);
	});

	it("marks the app's marker for the Environment", () => {
		const w = world();

		markApp({
			store: w.store,
			release: RELEASE,
			environment: 'staging',
			state: 'pending',
			source: 'local',
		});

		expect(w.marker('stream/staging')).toMatchObject({
			component: 'app',
			state: 'pending',
			environment: 'staging',
		});
	});
});
