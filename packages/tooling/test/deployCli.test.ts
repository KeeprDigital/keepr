import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { afterEach, describe, expect, it } from 'vitest';
import { formatMarker, parseMarker } from '../scripts/deploy/markers.mjs';

const CLI = join(import.meta.dirname, '../scripts/deploy/cli.mjs');

/**
 * `keepr-deploy`, as `pnpm run deploy` and the Deploy workflow run it. An empty
 * PATH means any git, pnpm or wrangler it tried to spawn would fail to start,
 * so these show what it refuses before it touches anything.
 */
describe('the keepr-deploy command line', () => {
	const roots: string[] = [];

	afterEach(() => {
		for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
	});

	function run(args: string[], cwd = process.cwd()) {
		return spawnSync(process.execPath, [CLI, ...args], {
			cwd,
			env: { ...process.env, PATH: '', CLOUDFLARE_API_TOKEN: 'blocked-by-test-guard' },
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

	function workspace(files: Record<string, string>) {
		const root = mkdtempSync(join(tmpdir(), 'keepr-cli-'));
		roots.push(root);
		for (const [path, content] of Object.entries(files)) {
			mkdirSync(dirname(join(root, path)), { recursive: true });
			writeFileSync(join(root, path), content);
		}
		return root;
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
				worker: { config: '.output/server/wrangler.json' },
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
				worker: { config: '../../packages/accounts-stand-in/stand-in.wrangler.jsonc' },
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

	/**
	 * Deploy order, wired: the check runs, `--override` reaches it, and what it
	 * answers reaches the marker. A Stream Keepr Release that binds Keepr Accounts and
	 * holds a Keepr Accounts change that `accounts/production` lacks. Real git,
	 * with a local bare repository as `origin`; only git is on PATH, and the
	 * Release has no Wrangler, so a deploy that gets past the check stops at
	 * its first Cloudflare step.
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

		function releaseAheadOfAccounts() {
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
					worker: { config: '.output/server/wrangler.json' },
					databases: [],
					environments: { production: { url: 'https://stream.keepr.digital' } },
					parts: {},
				}),
				'.gitignore': '.output/\n',
			});
			git(checkout, 'add', '.');
			git(checkout, 'commit', '-q', '-m', 'feat(accounts): what stream needs');
			git(checkout, 'push', '-q', 'origin', 'main', 'accounts/production');
			write(artifact, {
				'server/wrangler.json': JSON.stringify({
					name: 'stream-keepr',
					services: [{ binding: 'KEEPR_ACCOUNTS', service: 'keepr-accounts' }],
				}),
			});
			mkdirSync(bin);
			symlinkSync(
				execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim(),
				join(bin, 'git'),
			);
			const deploy = (...extra: string[]) =>
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
						env: { ...gitEnv, PATH: bin, CLOUDFLARE_API_TOKEN: 'blocked-by-test-guard' },
						encoding: 'utf8',
					},
				);
			const marker = (name: string) => {
				if (!git(origin, 'tag', '--list', name)) return undefined;
				return parseMarker(
					git(origin, 'for-each-ref', '--format=%(contents)', `refs/tags/${name}`),
				);
			};
			return { deploy, marker };
		}

		it('runs the check with --override, and the marker records what it answered', () => {
			const { deploy, marker } = releaseAheadOfAccounts();

			deploy('--override', 'Keepr Accounts is down; #1300');

			expect(marker('stream/production')).toMatchObject({
				state: 'pending',
				needs: 'accounts',
				override: 'Keepr Accounts is down; #1300',
			});
		});
	});
});
