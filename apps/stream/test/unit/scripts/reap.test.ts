import { describe, expect, it } from 'vitest';
import {
	acceptanceProfilePrefix,
	checkoutProfileMarker,
} from '../../../scripts/graphics-acceptance/chromium-profile.mjs';
import {
	reapLeakedAcceptanceChrome,
	selectLeakedAcceptanceChrome,
} from '../../../scripts/reap.mjs';

// Orphaned workerd, which `pnpm reap` reaps first, is the workspace reaper's
// and is tested with it (`packages/tooling/test/reapWorkerd.test.ts`).

const repositoryRoot = '/Users/dev/stream-keepr';
const externalWorktreeRoot = '/Users/dev/.codex/worktrees/a1b2/stream-keepr';
const checkoutRoots = [repositoryRoot, externalWorktreeRoot];

/**
 * A leaked acceptance Chrome (#687): headless, orphaned, and spinning, with a
 * temporary profile named after the checkout that launched it. That profile is
 * the only thing told apart here, so a person's own Chrome — same binary, same
 * helpers — is never in reach.
 */
describe('selecting leaked acceptance Chrome', () => {
	const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
	const helper =
		'/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/155.0.8059.85/Helpers/Google Chrome Helper (Renderer).app/Contents/MacOS/Google Chrome Helper (Renderer)';
	const profileOf = (root: string) =>
		`/var/folders/h9/xyz/T/${acceptanceProfilePrefix(checkoutProfileMarker(root))}AbC123`;
	const ours = profileOf(repositoryRoot);
	const browser = (profile: string) =>
		`${chrome} --headless=new --disable-gpu --no-sandbox --remote-debugging-port=0 --user-data-dir=${profile} --use-gl=angle`;
	const renderer = (profile: string) =>
		`${helper} --type=renderer --user-data-dir=${profile} --headless=new --lang=en-GB`;

	it("selects an orphaned headless browser with this repository's profile, and its helpers", () => {
		const psOutput = [
			`81000     1 ${browser(ours)}`,
			`81001 81000 ${renderer(ours)}`,
			`81002 81000 ${helper} --type=gpu-process --user-data-dir=${ours}`,
		].join('\n');

		expect(selectLeakedAcceptanceChrome(psOutput, checkoutRoots)).toEqual([81000, 81001, 81002]);
	});

	it('selects one launched from another registered checkout of this repository', () => {
		const psOutput = `81010     1 ${browser(profileOf(externalWorktreeRoot))}`;

		expect(selectLeakedAcceptanceChrome(psOutput, checkoutRoots)).toEqual([81010]);
	});

	it('leaves the browser of a run still in progress alone', () => {
		const psOutput = [`81020 81019 ${browser(ours)}`, `81021 81020 ${renderer(ours)}`].join('\n');

		expect(selectLeakedAcceptanceChrome(psOutput, checkoutRoots)).toEqual([]);
	});

	it("leaves a person's own Chrome alone, orphaned or not", () => {
		const psOutput = [
			`500     1 ${chrome}`,
			`501   500 ${helper} --type=renderer --user-data-dir=/Users/dev/Library/Application Support/Google/Chrome`,
			`502     1 ${chrome} --headless=new --user-data-dir=/tmp/puppeteer_dev_profile-XyZ`,
		].join('\n');

		expect(selectLeakedAcceptanceChrome(psOutput, checkoutRoots)).toEqual([]);
	});

	it("leaves another repository's acceptance browser alone", () => {
		const psOutput = `81030     1 ${browser(profileOf('/Users/dev/other-project'))}`;

		expect(selectLeakedAcceptanceChrome(psOutput, checkoutRoots)).toEqual([]);
	});

	it("leaves an orphan with this repository's profile alone unless it is headless", () => {
		const psOutput = `81040     1 ${chrome} --user-data-dir=${ours}`;

		expect(selectLeakedAcceptanceChrome(psOutput, checkoutRoots)).toEqual([]);
	});

	it('terminates a leaked browser and escalates to SIGKILL when it ignores SIGTERM', async () => {
		const signals: Array<[number, string | number]> = [];
		const kill = (pid: number, signal: string | number) => {
			if (signal !== 0) signals.push([pid, signal]);
		};

		const reaped = await reapLeakedAcceptanceChrome({
			psOutput: `81000     1 ${browser(ours)}\n81001 81000 ${renderer(ours)}`,
			checkoutRoots,
			kill,
			sleep: async () => {},
		});

		expect(reaped).toEqual([81000, 81001]);
		expect(signals).toEqual([
			[81000, 'SIGTERM'],
			[81001, 'SIGTERM'],
			[81000, 'SIGKILL'],
			[81001, 'SIGKILL'],
		]);
	});
});
