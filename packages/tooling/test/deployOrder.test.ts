import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { afterEach, describe, expect, it } from 'vitest';
import type { MarkerStore } from '../scripts/deploy/markers.mjs';
import {
	checkDeployOrder,
	gitHistory,
	servicesBindKeeprAccounts,
} from '../scripts/deploy/order.mjs';
import type { Release } from '../scripts/deploy/release.mjs';

const directories: string[] = [];

afterEach(() => {
	for (const directory of directories.splice(0))
		rmSync(directory, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]) {
	return execFileSync('git', args, {
		cwd,
		encoding: 'utf8',
		env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
	}).trim();
}

/** A real repository whose history the cases write, one commit per change. */
function repository() {
	const root = mkdtempSync(join(tmpdir(), 'keepr-order-'));
	directories.push(root);
	git(root, 'init', '-q', '-b', 'main');
	return {
		root,
		/** Commit a change to `file`, and answer the commit. */
		change(file: string, message = `change ${file}`) {
			mkdirSync(join(root, dirname(file)), { recursive: true });
			writeFileSync(join(root, file), `${message}\n`);
			git(root, 'add', '.');
			git(
				root,
				'-c',
				'user.name=test',
				'-c',
				'user.email=test@example.invalid',
				'commit',
				'-q',
				'-m',
				message,
			);
			return git(root, 'rev-parse', 'HEAD');
		},
	};
}

type Repository = ReturnType<typeof repository>;

/** A marker as an annotated tag's message carries it, written out by hand. */
function appMarker(fields: { app: string; state?: string; commit: string; needs?: string }) {
	return [
		'stream-keepr promotion marker',
		'',
		'component: app',
		`state: ${fields.state ?? 'deployed'}`,
		`commit: ${fields.commit}`,
		'worktree: clean',
		'source: actions',
		`app: ${fields.app}`,
		'environment: production',
		'version: 1.0.0',
		...(fields.needs === undefined ? [] : [`needs: ${fields.needs}`]),
		'',
	].join('\n');
}

/** The marker remote in memory, with the checkout at `head`. */
function markers(head: string, tags: Record<string, string> = {}): MarkerStore {
	return {
		head: () => head,
		dirty: () => false,
		read: (name) => tags[name],
		write: () => {
			throw new Error('the order check writes no marker');
		},
		remove: () => {
			throw new Error('the order check removes no marker');
		},
		names: () => Object.keys(tags),
	};
}

/**
 * The Release of `app` in `repo`, built: its Worker configuration as the build
 * leaves it, binding Keepr Accounts or not.
 */
function built(repo: Repository, app: string, worker: Record<string, unknown> = {}): Release {
	const appDir = join(repo.root, 'apps', app);
	mkdirSync(join(appDir, '.output/server'), { recursive: true });
	writeFileSync(
		join(appDir, '.output/server/wrangler.json'),
		JSON.stringify({ name: `keepr-${app}`, ...worker }),
	);
	return {
		app,
		appDir,
		version: '1.0.0',
		descriptor: {
			app,
			build: ['build'],
			output: '.output',
			worker: { config: '.output/server/wrangler.json' },
			databases: [],
			environments: {
				production: { url: `https://${app}.keepr.digital` },
				staging: { url: `https://${app}.staging.keepr.digital`, wranglerEnv: 'staging' },
			},
			parts: {},
		},
		verifies: 'release',
	};
}

const BINDS_ACCOUNTS = {
	services: [{ binding: 'KEEPR_ACCOUNTS', service: 'keepr-accounts' }],
};

function quiet() {}

function check(
	repo: Repository,
	release: Release,
	store: MarkerStore,
	options: { environment?: string; override?: string } = {},
) {
	return checkDeployOrder({
		release,
		environment: options.environment ?? 'production',
		store,
		history: gitHistory({ cwd: repo.root }),
		log: quiet,
		...(options.override === undefined ? {} : { override: options.override }),
	});
}

// The one home of what binding Keepr Accounts means; the deploy and CI's scope
// differ only in which blocks of a configuration they read.
describe("whether a block's service bindings bind Keepr Accounts", () => {
	it.each([
		['no services', undefined, false],
		['another service only', [{ binding: 'OTHER', service: 'other' }], false],
		['Keepr Accounts among others', [{ service: 'other' }, BINDS_ACCOUNTS.services[0]], true],
	])('%s', (_case, services, expected) => {
		expect(servicesBindKeeprAccounts(services)).toBe(expected);
	});
});

describe('an App that binds Keepr Accounts', () => {
	it('is refused when its Release holds a Keepr Accounts change the deployed Keepr Accounts lacks', () => {
		const repo = repository();
		const live = repo.change('apps/accounts/server/a.ts');
		repo.change('apps/accounts/server/b.ts', 'feat(accounts): what stream now needs');
		const head = repo.change('apps/stream/server/c.ts');

		expect(() =>
			check(
				repo,
				built(repo, 'stream', BINDS_ACCOUNTS),
				markers(head, { 'accounts/production': appMarker({ app: 'accounts', commit: live }) }),
			),
		).toThrow(/accounts\/production.*lacks.*what stream now needs/s);
	});

	it.each([
		['only its own changes since the deployed Keepr Accounts', 'apps/stream/server/d.ts'],
		['a change beside Keepr Accounts, not under it', 'packages/nuxt-layer/server/e.ts'],
	])(
		'deploys when its Release holds %s, and records that it needs Keepr Accounts',
		(_case, file) => {
			const repo = repository();
			repo.change('apps/accounts/server/a.ts');
			const live = repo.change('apps/accounts/server/b.ts');
			const head = repo.change(file);

			expect(
				check(
					repo,
					built(repo, 'stream', BINDS_ACCOUNTS),
					markers(head, { 'accounts/production': appMarker({ app: 'accounts', commit: live }) }),
				),
			).toEqual({ needs: 'accounts' });
		},
	);

	it('deploys an older Release behind a newer Keepr Accounts', () => {
		const repo = repository();
		const head = repo.change('apps/stream/server/a.ts');
		const live = repo.change('apps/accounts/server/b.ts');

		expect(
			check(
				repo,
				built(repo, 'stream', BINDS_ACCOUNTS),
				markers(head, { 'accounts/production': appMarker({ app: 'accounts', commit: live }) }),
			),
		).toEqual({ needs: 'accounts' });
	});

	it.each([
		['has no Installation in the Environment', undefined, /missing/],
		[
			'deploy was never confirmed',
			appMarker({ app: 'accounts', state: 'pending', commit: '0'.repeat(40) }),
			/pending/,
		],
		['marker is unreadable', '', /unreadable/],
	])('is refused when Keepr Accounts %s', (_case, text, reason) => {
		const repo = repository();
		const head = repo.change('apps/stream/server/a.ts');
		const tags = text === undefined ? {} : { 'accounts/production': text };

		expect(() => check(repo, built(repo, 'stream', BINDS_ACCOUNTS), markers(head, tags))).toThrow(
			reason,
		);
	});

	it("is checked against its Environment's own block, since a service binding is not inherited", () => {
		const repo = repository();
		const head = repo.change('apps/accounts/server/a.ts');
		const release = built(repo, 'stream', {
			...BINDS_ACCOUNTS,
			env: { staging: { services: [{ binding: 'VALIDATOR', service: 'stream-validator' }] } },
		});

		expect(check(repo, release, markers(head), { environment: 'staging' })).toEqual({});
		expect(() => check(repo, release, markers(head))).toThrow(/accounts\/production/);
	});
});

describe('an App that does not bind Keepr Accounts', () => {
	it('is never checked, however far its Release is ahead of Keepr Accounts', () => {
		const repo = repository();
		const head = repo.change('apps/accounts/server/a.ts');

		expect(check(repo, built(repo, 'stream'), markers(head))).toEqual({});
	});
});

describe("Keepr Accounts' deploy", () => {
	/** Keepr Accounts at `older`; Stream Keepr at `newer`, past a Keepr Accounts change. */
	function rollback() {
		const repo = repository();
		const older = repo.change('apps/accounts/server/a.ts');
		repo.change('apps/accounts/server/b.ts', 'feat(accounts): what stream needs');
		const newer = repo.change('apps/stream/server/c.ts');
		return { repo, older, newer, release: built(repo, 'accounts') };
	}

	// A pending Installation may be serving either Release, so it counts too.
	it.each(['deployed', 'pending'])(
		'is refused on a commit lacking a Keepr Accounts change a %s dependent Installation contains',
		(state) => {
			const { repo, older, newer, release } = rollback();
			const store = markers(older, {
				'accounts/production': appMarker({ app: 'accounts', commit: newer }),
				'stream/production': appMarker({ app: 'stream', state, commit: newer, needs: 'accounts' }),
			});

			expect(() => check(repo, release, store)).toThrow(
				/stream\/production.*contains.*what stream needs/s,
			);
		},
	);

	it('deploys forward past every dependent', () => {
		const { repo, newer, release } = rollback();
		const head = repo.change('apps/accounts/server/d.ts');
		const store = markers(head, {
			'stream/production': appMarker({ app: 'stream', commit: newer, needs: 'accounts' }),
		});

		expect(check(repo, release, store)).toEqual({});
	});

	it.each([
		['an Installation that does not need it', 'stream/production', undefined],
		['an Installation in another Environment', 'stream/staging', 'accounts'],
		["a dependent's part", 'stream/production-validator', 'accounts'],
	])('deploys below %s', (_case, name, needs) => {
		const { repo, older, newer, release } = rollback();
		const tags = {
			[name]: appMarker({ app: 'stream', commit: newer, ...(needs ? { needs } : {}) }),
		};

		expect(check(repo, release, markers(older, tags))).toEqual({});
	});
});

describe('the history', () => {
	// A shallow clone would read a dependent's Keepr Accounts changes as absent.
	it('refuses to answer from a shallow clone', () => {
		const origin = repository();
		const behind = origin.change('apps/accounts/server/a.ts');
		origin.change('apps/accounts/server/b.ts');
		const clone = mkdtempSync(join(tmpdir(), 'keepr-order-clone-'));
		directories.push(clone);
		git(clone, 'clone', '-q', '--depth', '1', `file://${origin.root}`, '.');

		expect(() => gitHistory({ cwd: clone }).missing('HEAD', behind, 'apps/accounts')).toThrow(
			/full history/,
		);
	});
});

describe('an override', () => {
	const REASON = 'Keepr Accounts 0.2.0 is broken in production; #1300';

	/** Keepr Accounts' change `ahead` is in Stream Keepr's Release and not in `behind`. */
	function apart() {
		const repo = repository();
		const behind = repo.change('apps/accounts/server/a.ts');
		const ahead = repo.change('apps/accounts/server/b.ts');
		return { repo, behind, ahead };
	}

	it('deploys an App ahead of Keepr Accounts, and the marker records its reason', () => {
		const { repo, behind, ahead } = apart();
		const store = markers(ahead, {
			'accounts/production': appMarker({ app: 'accounts', commit: behind }),
		});

		expect(check(repo, built(repo, 'stream', BINDS_ACCOUNTS), store, { override: REASON })).toEqual(
			{ needs: 'accounts', override: REASON },
		);
	});

	it('deploys Keepr Accounts below a dependent, and the marker records its reason', () => {
		const { repo, behind, ahead } = apart();
		const store = markers(behind, {
			'stream/production': appMarker({ app: 'stream', commit: ahead, needs: 'accounts' }),
		});

		expect(check(repo, built(repo, 'accounts'), store, { override: REASON })).toEqual({
			override: REASON,
		});
	});

	it('is not recorded when nothing was refused', () => {
		const repo = repository();
		const head = repo.change('apps/stream/server/a.ts');

		expect(check(repo, built(repo, 'stream'), markers(head), { override: REASON })).toEqual({});
	});
});
