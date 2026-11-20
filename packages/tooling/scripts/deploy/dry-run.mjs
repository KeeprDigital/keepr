/**
 * An app's `worker:dry-run`, the part every deployable app shares: bundle the
 * built Worker as `wrangler deploy` would, without uploading it, for every
 * Environment its deploy descriptor names, so a configuration Wrangler
 * refuses in any of them fails the build rather than a deploy.
 *
 * Each bundle goes under `.wrangler/dry-run/<environment>` in the app's
 * directory, never inside the descriptor's `output`: that directory is the
 * artifact every Environment deploys, and a bundle left there would ship with
 * it. The `--outdir` is absolute, because Wrangler resolves a relative one
 * against the config's directory for the bundle and against the working
 * directory for the README beside it (apps/stream/scripts/worker-dry-run.mjs,
 * #318).
 */

import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @param {{
 *   appDir: string,
 *   descriptor: { worker: { config: string }, environments: import('./release.mjs').Descriptor['environments'] },
 *   wrangler?: string,
 * }} options `wrangler`: the app's own, by default
 * @returns {Record<string, string>} each Environment's bundle directory
 */
export function dryRunEveryEnvironment({
	appDir,
	descriptor,
	wrangler = join(appDir, 'node_modules/.bin/wrangler'),
}) {
	/** @type {Record<string, string>} */
	const bundles = {};
	for (const [environment, { wranglerEnv }] of Object.entries(descriptor.environments)) {
		const outDir = join(appDir, '.wrangler', 'dry-run', environment);
		// Emptied first, so what a scan reads is what this run produced.
		rmSync(outDir, { recursive: true, force: true });
		const dryRun = spawnSync(
			wrangler,
			[
				'deploy',
				'--dry-run',
				'--config',
				descriptor.worker.config,
				'--outdir',
				outDir,
				...(wranglerEnv === undefined ? [] : ['--env', wranglerEnv]),
			],
			{ cwd: appDir, stdio: 'inherit' },
		);
		if (dryRun.error)
			throw new Error(`could not run ${wrangler}: ${dryRun.error.message}`, {
				cause: dryRun.error,
			});
		// A signalled Wrangler reports a null status; that is a failure, not a pass.
		if (dryRun.status !== 0)
			throw new Error(
				`Wrangler refused the ${environment} bundle (status ${dryRun.status ?? dryRun.signal}).`,
			);
		bundles[environment] = outDir;
	}
	return bundles;
}
