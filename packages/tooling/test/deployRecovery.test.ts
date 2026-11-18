import { describe, expect, it } from 'vitest';
import { recordRecoveryPoints } from '../scripts/deploy/recovery.mjs';
import type { Release } from '../scripts/deploy/release.mjs';

const BOOKMARK = '00000085-0000024c-00004c6d-8e61117bf38d7adb71b934ebbf891683';

function release(bindings: string[]): Release {
	return {
		app: 'stream',
		appDir: '/release/apps/stream',
		version: '1.9.0',
		verifies: 'release',
		descriptor: {
			app: 'stream',
			build: [],
			output: '.output',
			parts: {},
			worker: { source: 'wrangler.jsonc', config: '.output/server/wrangler.json' },
			databases: bindings.map((binding) => ({ binding })),
			environments: {
				production: { url: 'https://stream.keepr.digital' },
				staging: { url: 'https://stream.keepr-staging.digital', wranglerEnv: 'staging' },
			},
		},
	};
}

/**
 * The D1 recovery point is read, not typed: each database's Time Travel
 * bookmark, before the deploy's first remote change, recorded in the app's
 * marker so a failed migration has a point to restore to.
 */
describe("a deploy reads each D1 database's recovery point before it changes anything", () => {
	it('records the bookmark of every database the descriptor migrates, and says how to restore it', () => {
		const lines: string[] = [];
		const bookmarks: Record<string, string> = { DB: BOOKMARK, AUDIT: 'audit-bookmark' };

		const recorded = recordRecoveryPoints({
			release: release(['DB', 'AUDIT']),
			environment: 'production',
			bookmark: (binding) => bookmarks[binding]!,
			log: (line) => lines.push(line),
		});

		expect(recorded).toEqual({ recovery: `DB=${BOOKMARK} AUDIT=audit-bookmark` });
		expect(lines.join('\n')).toContain(
			`wrangler d1 time-travel restore DB --bookmark=${BOOKMARK} --config .output/server/wrangler.json`,
		);
	});

	// The restore must select the same configuration block the deploy migrated.
	it("names the Environment's Wrangler block in the restore", () => {
		const lines: string[] = [];

		recordRecoveryPoints({
			release: release(['DB']),
			environment: 'staging',
			bookmark: () => BOOKMARK,
			log: (line) => lines.push(line),
		});

		expect(lines.join('\n')).toContain(
			`restore DB --bookmark=${BOOKMARK} --config .output/server/wrangler.json --env staging`,
		);
	});

	it('records nothing for an app with no D1 database', () => {
		expect(
			recordRecoveryPoints({
				release: release([]),
				environment: 'production',
				bookmark: () => {
					throw new Error('no database to read');
				},
				log: () => {},
			}),
		).toEqual({});
	});

	it.each([
		[
			'Time Travel cannot be read',
			() => {
				throw new Error('Authentication error [code: 10000]');
			},
			/no D1 recovery point for stream's DB in production: Authentication error/,
		],
		['no bookmark comes back', () => '', /no D1 recovery point for stream's DB in production/],
		[
			'the bookmark is not one token',
			() => 'a\nb',
			/no D1 recovery point for stream's DB in production/,
		],
	])('refuses the deploy when %s', (_, bookmark, refusal) => {
		expect(() =>
			recordRecoveryPoints({
				release: release(['DB']),
				environment: 'production',
				bookmark,
				log: () => {},
			}),
		).toThrow(refusal);
	});
});
