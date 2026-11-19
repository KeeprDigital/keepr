/**
 * `pnpm worker:dry-run`: bundles the built Worker as `wrangler deploy` would
 * for each Environment the deploy descriptor names, without uploading it, so a
 * configuration Wrangler refuses fails here rather than mid-deploy.
 *
 * The `--outdir` is absolute: Wrangler resolves a relative one against the
 * config's directory for the bundle but the working directory for its README
 * (apps/stream/scripts/worker-dry-run.mjs, #318).
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseJsonc } from '@keepr/tooling/scripts/jsonc.mjs';

const appRoot = fileURLToPath(new URL('../', import.meta.url));
const wrangler = fileURLToPath(new URL('../node_modules/.bin/wrangler', import.meta.url));
const descriptor = parseJsonc(readFileSync(new URL('../deploy.jsonc', import.meta.url), 'utf8'));

for (const [environment, { wranglerEnv }] of Object.entries(descriptor.environments)) {
	const outDir = fileURLToPath(
		new URL(`../.output/wrangler-dry-run/${environment}`, import.meta.url),
	);
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
			...(wranglerEnv ? ['--env', wranglerEnv] : []),
		],
		{ cwd: appRoot, stdio: 'inherit' },
	);
	if (dryRun.error) {
		process.stderr.write(`worker:dry-run: could not run ${wrangler}: ${dryRun.error.message}\n`);
		process.exit(1);
	}
	// A signalled Wrangler reports a null status; that is a failure, not a pass.
	if (dryRun.status !== 0) {
		process.stderr.write(`worker:dry-run: ${environment} refused\n`);
		process.exit(dryRun.status ?? 1);
	}
}
