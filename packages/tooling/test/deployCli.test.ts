import { execFileSync, spawn, spawnSync } from 'node:child_process';
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { afterEach, describe, expect, it } from 'vitest';
import { formatMarker } from '../scripts/deploy/markers.mjs';
import {
	emptyGitHub,
	fakeGhScript,
	fakeGitHub,
	readGitHubState,
	writeGitHubState,
} from './helpers/fakeGitHub.ts';

const CLI = join(import.meta.dirname, '../scripts/deploy/cli.mjs');

const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const gitIn = (cwd: string, ...args: string[]) =>
	execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', ...args], {
		cwd,
		encoding: 'utf8',
		env: gitEnv,
	}).trim();

/**
 * `keepr-deploy`, as `pnpm run deploy` and the Deploy workflow run it. A PATH
 * holding only git means any pnpm or wrangler it tried to spawn would fail to
 * start, so these show what it refuses before it touches anything.
 */
describe('the keepr-deploy command line', () => {
	const roots: string[] = [];
	const onlyGit = mkdtempSync(join(tmpdir(), 'keepr-cli-bin-'));
	symlinkSync(
		execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim(),
		join(onlyGit, 'git'),
	);

	afterEach(() => {
		for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
	});

	function run(args: string[], cwd = process.cwd(), env: Record<string, string> = {}) {
		return spawnSync(process.execPath, [CLI, ...args], {
			cwd,
			env: { ...gitEnv, PATH: onlyGit, CLOUDFLARE_API_TOKEN: 'blocked-by-test-guard', ...env },
			encoding: 'utf8',
		});
	}

	it.each([
		['an unknown command', ['bogus']],
		['a deploy naming no Environment', ['deploy', '--app', 'stream']],
		['a deploy naming no app', ['deploy', '--env', 'production']],
		[
			'an unknown mode',
			['deploy', '--app', 'stream', '--env', 'production', '--parts', 'sometimes'],
		],
		[
			'an unknown marker state',
			['mark-app', 'confirmed', '--app', 'stream', '--env', 'production'],
		],
		['an unknown option', ['status', '--app', 'stream', '--env', 'production', '--force']],
		[
			'an override of anything but a deploy',
			['mark-app', 'deployed', '--app', 'stream', '--env', 'production', '--override', 'why'],
		],
		[
			'an override with no reason',
			['deploy', '--app', 'stream', '--env', 'production', '--override', ' '],
		],
		[
			'an override whose reason spans lines',
			['deploy', '--app', 'stream', '--env', 'production', '--override', 'down\n#1300'],
		],
	])('refuses %s with its usage, exit 2', (_case, args) => {
		const result = run(args);

		expect(result.status).toBe(2);
		expect(result.stderr).toContain('usage: keepr-deploy');
	});

	/** A Release checkout holding `files`, committed. */
	function workspace(files: Record<string, string>) {
		const root = mkdtempSync(join(tmpdir(), 'keepr-cli-'));
		roots.push(root);
		for (const [path, content] of Object.entries(files)) {
			mkdirSync(dirname(join(root, path)), { recursive: true });
			writeFileSync(join(root, path), content);
		}
		gitIn(root, 'init', '-q', '-b', 'main');
		gitIn(root, 'add', '.');
		gitIn(root, 'commit', '-q', '--allow-empty', '-m', 'the Release');
		return root;
	}

	/** What a build of `commit` leaves beside its output, in the app's output directory. */
	function recordBuildOf(root: string, commit: string) {
		writeFileSync(
			join(root, 'apps/stream/.output/keepr-build.json'),
			JSON.stringify({ commit, testFlags: [] }),
		);
	}

	// CI's Worker leg: a part that would not bundle fails it before the app's build starts.
	it('checks an app by bundling each part before its build, needing no Environment', () => {
		const root = workspace({
			'pnpm-workspace.yaml': 'packages: []\n',
			'apps/stream/package.json': JSON.stringify({ name: '@keepr/stream', version: '1.8.0' }),
			'apps/stream/deploy.jsonc': JSON.stringify({
				app: 'stream',
				build: ['build'],
				output: '.output',
				worker: { source: 'wrangler.jsonc', config: '.output/server/wrangler.json' },
				databases: [],
				environments: { production: { url: 'https://stream.keepr.digital' } },
				parts: { validator: { config: 'workers/validator/wrangler.jsonc' } },
			}),
		});

		const result = run(['check', '--app', 'stream'], root);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain('could not bundle workers/validator/wrangler.jsonc');
		expect(result.stderr).not.toContain('pnpm run build');
	});

	// An operator's check of an Environment, before any deploy: Wrangler is the
	// Release's own, faked here to list one secret the Worker lacks another beside.
	it("checks an Environment's Installation for the Worker secrets its descriptor requires, building nothing", () => {
		const root = workspace({
			'pnpm-workspace.yaml': 'packages: []\n',
			'apps/stream/package.json': JSON.stringify({ name: '@keepr/stream', version: '1.9.0' }),
			'apps/stream/deploy.jsonc': JSON.stringify({
				app: 'stream',
				build: ['build'],
				output: '.output',
				worker: {
					source: 'wrangler.jsonc',
					config: '.output/server/wrangler.json',
					secrets: ['NUXT_BETTER_AUTH_SECRET', 'NUXT_ABLY_API_KEY'],
				},
				databases: [],
				environments: {
					staging: { url: 'https://stream.keepr-staging.digital', wranglerEnv: 'staging' },
				},
				parts: {},
			}),
			'apps/stream/wrangler.jsonc': JSON.stringify({ env: { staging: { name: 'stream' } } }),
			'apps/stream/.output/server/wrangler.json': '{"name":"stream"}',
			'apps/stream/node_modules/.bin/wrangler': `#!${process.execPath}\nconsole.log(JSON.stringify([{ name: 'NUXT_ABLY_API_KEY', type: 'secret_text' }]));\n`,
		});
		chmodSync(join(root, 'apps/stream/node_modules/.bin/wrangler'), 0o755);
		recordBuildOf(root, gitIn(root, 'rev-parse', 'HEAD'));

		const result = run(['check', '--app', 'stream', '--env', 'staging'], root);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain(
			"stream's Worker lacks NUXT_BETTER_AUTH_SECRET: set each with pnpm secrets:sync --app stream --env staging, or from apps/stream with wrangler secret put <NAME> --config wrangler.jsonc --env staging",
		);
		expect(result.stderr).not.toContain('pnpm run build');
	});

	// What each reads of the built configuration must be this checkout's build.
	it.each<[string, string[], string | undefined, RegExp]>([
		['mark-app', ['mark-app', 'deployed'], 'f'.repeat(40), /built from f{40}/],
		['mark-app', ['mark-app', 'deployed'], undefined, /records no commit/],
		['status', ['status'], 'f'.repeat(40), /built from f{40}/],
		['check --env', ['check'], 'f'.repeat(40), /built from f{40}/],
	])('%s refuses a build that is not of this checkout', (_case, command, builtFrom, message) => {
		const root = workspace({
			'pnpm-workspace.yaml': 'packages: []\n',
			'apps/stream/package.json': JSON.stringify({ name: '@keepr/stream', version: '1.9.0' }),
			'apps/stream/deploy.jsonc': JSON.stringify({
				app: 'stream',
				build: ['build'],
				output: '.output',
				worker: { source: 'wrangler.jsonc', config: '.output/server/wrangler.json' },
				databases: [],
				environments: { production: { url: 'https://stream.keepr.digital' } },
				parts: {},
			}),
			'apps/stream/wrangler.jsonc': '{}',
			'apps/stream/.output/server/wrangler.json': '{"name":"stream"}',
		});
		if (builtFrom) recordBuildOf(root, builtFrom);

		const result = run([...command, '--app', 'stream', '--env', 'production'], root);

		expect(result.status).toBe(1);
		expect(result.stderr).toMatch(message);
	});

	// The Deploy workflow's build job: what it uploads is what every Environment deploys.
	describe('a build for an artifact', () => {
		const release = {
			'pnpm-workspace.yaml': 'packages: []\n',
			'apps/stream/package.json': JSON.stringify({ name: '@keepr/stream', version: '1.9.0' }),
			'apps/stream/deploy.jsonc': JSON.stringify({
				app: 'stream',
				build: [],
				output: '.output',
				worker: { source: 'wrangler.jsonc', config: '.output/server/wrangler.json' },
				databases: [],
				environments: { production: { url: 'https://stream.keepr.digital' } },
				parts: {},
			}),
		};

		it("copies the descriptor's output, as built, to the artifact directory, with the commit it was built from", () => {
			const root = workspace({
				...release,
				'apps/stream/.output/server/wrangler.json': '{"name":"stream"}',
			});
			const artifact = join(root, 'artifact');

			const result = run(['build', '--app', 'stream', '--artifact', artifact], root);

			expect(result.status, result.stderr).toBe(0);
			expect(readFileSync(join(artifact, 'server/wrangler.json'), 'utf8')).toBe(
				'{"name":"stream"}',
			);
			expect(JSON.parse(readFileSync(join(artifact, 'keepr-build.json'), 'utf8'))).toEqual({
				commit: gitIn(root, 'rev-parse', 'HEAD'),
				testFlags: [],
			});
		});

		it('records each test-only flag the descriptor names that was set for the build', () => {
			const root = workspace({
				...release,
				'apps/stream/deploy.jsonc': JSON.stringify({
					...JSON.parse(release['apps/stream/deploy.jsonc']),
					testFlags: ['STREAM_KEEPR_INTEGRATION', 'STREAM_KEEPR_OTHER'],
				}),
				'apps/stream/.output/server/wrangler.json': '{"name":"stream"}',
			});
			const artifact = join(root, 'artifact');

			run(['build', '--app', 'stream', '--artifact', artifact], root, {
				STREAM_KEEPR_INTEGRATION: 'true',
				STREAM_KEEPR_OTHER: 'false',
			});

			expect(JSON.parse(readFileSync(join(artifact, 'keepr-build.json'), 'utf8'))).toMatchObject({
				testFlags: ['STREAM_KEEPR_INTEGRATION'],
			});
		});

		// Nuxt reads the app's `.env` into the build, so a flag there makes a test build too.
		it("records a test-only flag set in the app's .env", () => {
			const root = workspace({
				...release,
				'apps/stream/deploy.jsonc': JSON.stringify({
					...JSON.parse(release['apps/stream/deploy.jsonc']),
					testFlags: ['STREAM_KEEPR_INTEGRATION'],
				}),
				'apps/stream/.output/server/wrangler.json': '{"name":"stream"}',
			});
			writeFileSync(join(root, 'apps/stream/.env'), 'STREAM_KEEPR_INTEGRATION="true"\n');
			const artifact = join(root, 'artifact');

			run(['build', '--app', 'stream', '--artifact', artifact], root);

			expect(JSON.parse(readFileSync(join(artifact, 'keepr-build.json'), 'utf8'))).toMatchObject({
				testFlags: ['STREAM_KEEPR_INTEGRATION'],
			});
		});

		it('fails when the build left no Worker configuration to deploy', () => {
			const root = workspace(release);

			const result = run(['build', '--app', 'stream', '--artifact', join(root, 'artifact')], root);

			expect(result.status).toBe(1);
			expect(result.stderr).toContain('.output/server/wrangler.json');
		});
	});

	// Wiring for `build.mjs`: the build an Environment deploys, and CI's Worker
	// leg, start the Release's own stand-in around each script, in the app's
	// directory. The launcher here records what it was handed and runs nothing.
	it.each([['build'], ['check']])(
		'%s runs the build scripts of an app that binds Keepr Accounts beside the Accounts Stand-in',
		(command) => {
			const root = workspace({
				'pnpm-workspace.yaml': 'packages: []\n',
				'apps/stream/package.json': JSON.stringify({ name: '@keepr/stream', version: '4.0.0' }),
				'apps/stream/deploy.jsonc': JSON.stringify({
					app: 'stream',
					build: ['build', 'worker:smoke'],
					output: '.output',
					worker: { source: 'wrangler.jsonc', config: '.output/server/wrangler.json' },
					databases: [],
					environments: { production: { url: 'https://stream.keepr.digital' } },
					parts: {},
				}),
				'apps/stream/wrangler.jsonc': JSON.stringify({
					services: [{ binding: 'KEEPR_ACCOUNTS', service: 'keepr-accounts' }],
				}),
				'packages/accounts-stand-in/scripts/stand-in.mjs':
					"import { appendFileSync } from 'node:fs';\n" +
					"appendFileSync(new URL('../../../ran', import.meta.url), `${process.cwd().split('/').at(-1)} ${process.argv.slice(2).join(' ')}\\n`);\n",
			});

			const result = run([command, '--app', 'stream'], root);

			expect(result.status, result.stderr).toBe(0);
			expect(readFileSync(join(root, 'ran'), 'utf8')).toBe(
				'stream -- pnpm run build\nstream -- pnpm run worker:smoke\n',
			);
		},
	);

	/**
	 * The staging job's acceptance gates: each runs as the app's package script
	 * against the Environment's Installation. A fake `pnpm`, alone on PATH,
	 * records what it ran and where, and exits with the gate's status.
	 */
	describe('the acceptance gates', () => {
		function gates(app: Record<string, unknown>, status = 0) {
			const root = workspace({
				'pnpm-workspace.yaml': 'packages: []\n',
				'apps/stream/package.json': JSON.stringify({ name: '@keepr/stream', version: '1.9.0' }),
				'apps/stream/deploy.jsonc': JSON.stringify({
					app: 'stream',
					build: ['build'],
					output: '.output',
					worker: { source: 'wrangler.jsonc', config: '.output/server/wrangler.json' },
					databases: [],
					environments: {
						production: { url: 'https://stream.keepr.digital' },
						staging: { url: 'https://stream.keepr-staging.digital', wranglerEnv: 'staging' },
					},
					parts: {},
					...app,
				}),
			});
			const ran = join(root, 'ran');
			mkdirSync(join(root, 'bin'));
			writeFileSync(
				join(root, 'bin/pnpm'),
				`#!/bin/sh\necho "\${PWD##*/} $* $KEEPR_DEPLOY_URL" >> '${ran}'\nexit ${status}\n`,
			);
			chmodSync(join(root, 'bin/pnpm'), 0o755);
			const result = spawnSync(
				process.execPath,
				[CLI, 'gates', '--app', 'stream', '--env', 'staging'],
				{
					cwd: root,
					env: {
						...process.env,
						PATH: join(root, 'bin'),
						CLOUDFLARE_API_TOKEN: 'blocked-by-test-guard',
					},
					encoding: 'utf8',
				},
			);
			return { result, ran: existsSync(ran) ? readFileSync(ran, 'utf8') : '' };
		}

		it("runs each of the app's gates in its directory, against the Environment's Installation", () => {
			const { result, ran } = gates({ gates: ['accept:deployed', 'accept:other'] });

			expect(result.status, result.stderr).toBe(0);
			expect(ran).toBe(
				'stream run accept:deployed https://stream.keepr-staging.digital\n' +
					'stream run accept:other https://stream.keepr-staging.digital\n',
			);
		});

		it('fails on the first gate that fails, and runs none after it', () => {
			const { result, ran } = gates({ gates: ['accept:deployed', 'accept:other'] }, 1);

			expect(result.status).toBe(1);
			expect(ran.split('\n').filter(Boolean)).toHaveLength(1);
		});

		// A Release from before gates, or an app with none, passes and says so.
		it('passes, saying so, when the Release names no gate', () => {
			const { result, ran } = gates({});

			expect(result.status).toBe(0);
			expect(result.stdout).toContain('no acceptance gates');
			expect(ran).toBe('');
		});
	});

	it('refuses a descriptor that would deploy the Accounts Stand-in before building anything', () => {
		const root = mkdtempSync(join(tmpdir(), 'keepr-cli-'));
		roots.push(root);
		const files = {
			'pnpm-workspace.yaml': 'packages: []\n',
			'packages/accounts-stand-in/package.json': JSON.stringify({
				name: '@keepr/accounts-stand-in',
				keepr: { undeployable: 'the Accounts Stand-in admits anyone.' },
			}),
			'apps/stream/package.json': JSON.stringify({ name: '@keepr/stream', version: '1.8.0' }),
			'apps/stream/deploy.jsonc': JSON.stringify({
				app: 'stream',
				build: ['build'],
				output: '.output',
				worker: {
					source: 'wrangler.jsonc',
					config: '../../packages/accounts-stand-in/stand-in.wrangler.jsonc',
				},
				databases: [],
				environments: { production: { url: 'https://stream.keepr.digital' } },
				parts: {},
			}),
		};
		for (const [path, content] of Object.entries(files)) {
			mkdirSync(dirname(join(root, path)), { recursive: true });
			writeFileSync(join(root, path), content);
		}

		const result = run(
			['deploy', '--app', 'stream', '--env', 'production'],
			join(root, 'apps/stream'),
		);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain('admits anyone');
		expect(result.stderr).not.toMatch(/spawn|ENOENT/);
	});

	// The configs name the account (ADR-0130); each command that deploys checks an export against them first.
	it.each([[['deploy']], [['part', 'validator']]])(
		'refuses %j with an exported account its configs contradict, before running anything',
		(command) => {
			const root = workspace({
				'pnpm-workspace.yaml': 'packages: []\n',
				'apps/stream/package.json': JSON.stringify({ name: '@keepr/stream', version: '1.9.0' }),
				'apps/stream/deploy.jsonc': JSON.stringify({
					app: 'stream',
					build: ['build'],
					output: '.output',
					worker: { source: 'wrangler.jsonc', config: '.output/server/wrangler.json' },
					databases: [],
					environments: { production: { url: 'https://stream.keepr.digital' } },
					parts: { validator: { config: 'workers/validator/wrangler.jsonc' } },
				}),
				'apps/stream/wrangler.jsonc': JSON.stringify({ account_id: 'a'.repeat(32) }),
				'apps/stream/workers/validator/wrangler.jsonc': JSON.stringify({}),
			});

			const result = run(
				[...command, '--app', 'stream', '--env', 'production'],
				join(root, 'apps/stream'),
				{ CLOUDFLARE_ACCOUNT_ID: 'b'.repeat(32) },
			);

			expect(result.status).toBe(1);
			expect(result.stderr).toContain('wrangler.jsonc names another account for production');
			expect(result.stderr).not.toMatch(/spawn|ENOENT/);
		},
	);

	/**
	 * Deploy order, wired: the check runs, `--override` reaches it, and what it
	 * answers reaches the marker. A Stream Keepr Release that binds Keepr Accounts and
	 * holds a Keepr Accounts change that `accounts/production` lacks, still the
	 * tag marker that GitHub Deployments replace (ADR-0133). Real git, with a
	 * local bare repository as `origin`; only git and a `gh` answering from the
	 * fake GitHub are on PATH, and the Release has no Wrangler, so a deploy that
	 * gets past the check stops at its first Cloudflare step.
	 */
	describe('deploy order', () => {
		const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
		const git = (cwd: string, ...args: string[]) =>
			execFileSync(
				'git',
				['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', ...args],
				{
					cwd,
					encoding: 'utf8',
					env: gitEnv,
				},
			).trim();

		function releaseAheadOfAccounts({
			databases = [] as { binding: string }[],
			tag = true,
			url = 'https://stream.keepr.digital',
			wrangler = false,
		} = {}) {
			const root = mkdtempSync(join(tmpdir(), 'keepr-cli-order-'));
			roots.push(root);
			const [origin, checkout, artifact, bin] = ['origin', 'checkout', 'artifact', 'bin'].map(
				(name) => join(root, name),
			) as [string, string, string, string];
			const write = (base: string, files: Record<string, string>) => {
				for (const [path, content] of Object.entries(files)) {
					mkdirSync(dirname(join(base, path)), { recursive: true });
					writeFileSync(join(base, path), content);
				}
			};
			mkdirSync(origin);
			git(origin, 'init', '-q', '--bare', '-b', 'main');
			git(root, 'clone', '-q', origin, checkout);
			write(checkout, {
				'pnpm-workspace.yaml': 'packages: []\n',
				'apps/accounts/server/a.ts': 'a\n',
			});
			git(checkout, 'add', '.');
			git(checkout, 'commit', '-q', '-m', 'Keepr Accounts as deployed');
			const live = git(checkout, 'rev-parse', 'HEAD');
			git(
				checkout,
				'tag',
				'-a',
				'accounts/production',
				'-m',
				formatMarker({ component: 'app', state: 'deployed', commit: live, app: 'accounts' }),
			);
			write(checkout, {
				'apps/accounts/server/b.ts': 'b\n',
				'apps/stream/package.json': JSON.stringify({ name: '@keepr/stream', version: '1.9.0' }),
				'apps/stream/deploy.jsonc': JSON.stringify({
					app: 'stream',
					build: ['build'],
					output: '.output',
					worker: { source: 'wrangler.jsonc', config: '.output/server/wrangler.json' },
					databases,
					environments: { production: { url } },
					parts: {},
				}),
				'apps/stream/wrangler.jsonc': '{}',
				'.gitignore': '.output/\nnode_modules/\n',
			});
			git(checkout, 'add', '.');
			git(checkout, 'commit', '-q', '-m', 'feat(accounts): what stream needs');
			if (tag) git(checkout, 'tag', '@keepr/stream@1.9.0');
			git(checkout, 'push', '-q', 'origin', 'main', 'accounts/production');
			const head = git(checkout, 'rev-parse', 'HEAD');
			write(artifact, {
				'server/wrangler.json': JSON.stringify({
					name: 'stream-keepr',
					services: [{ binding: 'KEEPR_ACCOUNTS', service: 'keepr-accounts' }],
				}),
				'keepr-build.json': JSON.stringify({ commit: head, testFlags: [] }),
			});
			// The Release's Wrangler, which every Cloudflare step runs: it succeeds
			// and changes nothing, and answers a bookmark and no secrets.
			if (wrangler)
				write(checkout, {
					'apps/stream/node_modules/.bin/wrangler': `#!${process.execPath}\nif (process.argv.includes('time-travel')) console.log(JSON.stringify({ bookmark: 'bookmark-1' }));\nelse if (process.argv.includes('secret')) console.log('[]');\n`,
				});
			if (wrangler) chmodSync(join(checkout, 'apps/stream/node_modules/.bin/wrangler'), 0o755);
			mkdirSync(bin);
			symlinkSync(
				execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim(),
				join(bin, 'git'),
			);
			const github = join(root, 'github.json');
			writeGitHubState(github, emptyGitHub([git(checkout, 'rev-parse', 'HEAD')]));
			writeFileSync(join(bin, 'gh'), fakeGhScript(github));
			chmodSync(join(bin, 'gh'), 0o755);
			const deploy = (extra: string[] = [], env: Record<string, string> = {}) =>
				spawnSync(
					process.execPath,
					[
						CLI,
						'deploy',
						'--app',
						'stream',
						'--env',
						'production',
						'--artifact',
						artifact,
						...extra,
					],
					{
						cwd: checkout,
						env: {
							...gitEnv,
							PATH: bin,
							CLOUDFLARE_API_TOKEN: 'blocked-by-test-guard',
							...env,
						},
						encoding: 'utf8',
					},
				);
			/** The same deploy, leaving this process free to answer it. */
			const deployAsync = (extra: string[] = [], env: Record<string, string> = {}) =>
				new Promise<{ status: number | null; output: string }>((resolve) => {
					const child = spawn(
						process.execPath,
						[
							CLI,
							'deploy',
							'--app',
							'stream',
							'--env',
							'production',
							'--artifact',
							artifact,
							...extra,
						],
						{
							cwd: checkout,
							env: { ...gitEnv, PATH: bin, CLOUDFLARE_API_TOKEN: 'blocked-by-test-guard', ...env },
						},
					);
					let output = '';
					child.stdout.on('data', (chunk) => (output += chunk));
					child.stderr.on('data', (chunk) => (output += chunk));
					child.on('close', (status) => resolve({ status, output }));
				});
			const marker = (name: string) => {
				const [latest] = fakeGitHub(readGitHubState(github)).history(name);
				return latest && { ...(latest.payload as object), statuses: latest.statuses };
			};
			return { deploy, deployAsync, marker, artifact, checkout };
		}

		it('runs the check with --override, and the marker records what it answered', () => {
			const { deploy, marker } = releaseAheadOfAccounts();

			deploy(['--override', 'Keepr Accounts is down; #1300']);

			expect(marker('stream/production')).toMatchObject({
				statuses: ['in_progress'],
				needs: 'accounts',
				override: 'Keepr Accounts is down; #1300',
			});
		});

		// The Release has no Wrangler to read Time Travel with, as when Cloudflare cannot answer.
		it('refuses without a D1 recovery point, after deploy order and before any marker moves', () => {
			const { deploy, marker } = releaseAheadOfAccounts({ databases: [{ binding: 'DB' }] });

			const result = deploy(['--override', 'Keepr Accounts is down; #1300']);

			expect(result.status).toBe(1);
			expect(result.stdout).toContain("no D1 recovery point for stream's DB in production");
			expect(marker('stream/production')).toBeUndefined();
		});

		it('refuses a production deploy whose HEAD is no Release without --unreleased, and records the reason given', () => {
			const { deploy, marker } = releaseAheadOfAccounts({ tag: false });
			const override = ['--override', 'Keepr Accounts is down; #1300'];

			const refused = deploy(override);

			expect(refused.status).toBe(1);
			expect(refused.stdout).toContain('HEAD is not @keepr/stream@1.9.0');
			expect(marker('stream/production')).toBeUndefined();

			deploy([...override, '--unreleased', 'hotfix ahead of its Release; #1301']);

			expect(marker('stream/production')).toMatchObject({
				unreleased: 'hotfix ahead of its Release; #1301',
			});
		});

		it("refuses an artifact built from another commit than the Release's, before any marker moves", () => {
			const { deploy, marker, artifact } = releaseAheadOfAccounts();
			writeFileSync(
				join(artifact, 'keepr-build.json'),
				JSON.stringify({ commit: 'f'.repeat(40), testFlags: [] }),
			);

			const result = deploy(['--override', 'Keepr Accounts is down; #1300']);

			expect(result.status).toBe(1);
			expect(result.stdout).toContain(`built from ${'f'.repeat(40)}`);
			expect(marker('stream/production')).toBeUndefined();
		});

		// KEEPR_DEPLOY_URL is `verify`'s alone: a deploy that read it would verify another Installation than it deployed.
		it("verifies the Environment's URL whatever KEEPR_DEPLOY_URL says, and records the recovery point read before the migration", async () => {
			/** A local origin answering `/api/release` with what `body` names when asked. */
			const serve = (body: () => unknown) =>
				new Promise<{ url: string; close: () => void }>((resolve) => {
					const server = createServer((_request, response) => {
						response.writeHead(200, { 'content-type': 'application/json' });
						response.end(JSON.stringify(body()));
					});
					server.listen(0, '127.0.0.1', () => {
						const { port } = server.address() as AddressInfo;
						resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() });
					});
				});
			let deployed = '';
			const elsewhere = await serve(() => ({
				app: 'stream',
				version: '0.0.1',
				commit: 'f'.repeat(40),
			}));
			const installation = await serve(() => ({
				app: 'stream',
				version: '1.9.0',
				commit: deployed,
			}));
			try {
				const { deployAsync, marker, checkout } = releaseAheadOfAccounts({
					url: installation.url,
					wrangler: true,
					databases: [{ binding: 'DB' }],
				});
				deployed = git(checkout, 'rev-parse', 'HEAD');

				const result = await deployAsync(['--override', 'Keepr Accounts is down; #1300'], {
					KEEPR_DEPLOY_URL: elsewhere.url,
				});

				expect(result.status, result.output).toBe(0);
				expect(marker('stream/production')).toMatchObject({
					statuses: ['in_progress', 'success'],
					recovery: 'DB=bookmark-1',
				});
			} finally {
				elsewhere.close();
				installation.close();
			}
		});
	});
});
