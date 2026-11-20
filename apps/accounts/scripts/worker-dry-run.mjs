/**
 * `pnpm worker:dry-run`: bundles the built Worker as `wrangler deploy` would
 * for each Environment the deploy descriptor names, without uploading it, so a
 * configuration Wrangler refuses fails here rather than mid-deploy. Each
 * bundle lands outside `.output`, the artifact a deploy uploads
 * (`@keepr/tooling/scripts/deploy/dry-run.mjs`).
 */

import { readFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { dryRunEveryEnvironment } from '@keepr/tooling/scripts/deploy/dry-run.mjs';
import { parseJsonc } from '@keepr/tooling/scripts/jsonc.mjs';

const appDir = fileURLToPath(new URL('../', import.meta.url));
const descriptor = parseJsonc(readFileSync(new URL('../deploy.jsonc', import.meta.url), 'utf8'));

try {
	dryRunEveryEnvironment({ appDir, descriptor });
} catch (error) {
	process.stderr.write(`worker:dry-run: ${/** @type {Error} */ (error).message}\n`);
	process.exit(1);
}
