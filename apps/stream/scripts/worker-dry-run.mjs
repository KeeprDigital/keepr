/**
 * `pnpm worker:dry-run` — bundle the built Worker exactly as `wrangler deploy`
 * would without promoting it, then assert the bundle compiles no Wasm at
 * runtime, carries no Accounts Stand-in (ADR-0113), and that the built CSS holds
 * every declared application font face.
 *
 * The `--outdir` is absolute, and that is the whole point of this file.
 * Wrangler resolves a *relative* `--outdir` against the directory of its
 * `--config` file for the bundle but against the working directory for the
 * README it drops beside it, and this command's config is
 * `.output/server/wrangler.json`. So the repository-relative path the README
 * documented put the real bundle at `.output/server/.output/wrangler-dry-run/`
 * while wrangler created `.output/wrangler-dry-run/` anyway and left a README
 * in it announcing "the built output assets" — a grep of the documented path
 * came back empty and read exactly like a clean bundle (#318). Writing
 * `../wrangler-dry-run` instead only moves the trap: measured, it lands the
 * bundle correctly and the README *outside the repository*. An absolute path
 * is the one form both resolutions agree on.
 *
 * The `.env` a previewed Worker reads has the same config-relative rule and cost
 * this repository more; see `scripts/stage-preview-secrets.mjs`.
 *
 * Every Environment the deploy descriptor names is bundled with its own
 * Wrangler env, each under `.wrangler/dry-run/<environment>`, outside
 * `.output`, which is the artifact a deploy uploads
 * (`@keepr/tooling/scripts/deploy/dry-run.mjs`). Each bundle is scanned.
 */

import { readFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { standInScan } from '@keepr/accounts-stand-in/bundle-scan';
import { dryRunEveryEnvironment } from '@keepr/tooling/scripts/deploy/dry-run.mjs';
import { parseJsonc } from '@keepr/tooling/scripts/jsonc.mjs';
import { builtFontsScan } from './assert-built-fonts.mjs';
import { runtimeWasmScan } from './assert-no-runtime-wasm.mjs';

/** The static assets, where Nuxt Fonts' `@font-face` rules land (ADR-0086). */
const PUBLIC_DIR = '.output/public';

const appDir = fileURLToPath(new URL('../', import.meta.url));
const descriptor = parseJsonc(readFileSync(new URL('../deploy.jsonc', import.meta.url), 'utf8'));

let bundles;
try {
	bundles = dryRunEveryEnvironment({ appDir, descriptor });
} catch (error) {
	process.stderr.write(`worker:dry-run: ${/** @type {Error} */ (error).message}\n`);
	process.exit(1);
}

const scans = [
	...Object.values(bundles).map((outDir) => runtimeWasmScan(outDir)),
	...Object.values(bundles).map((outDir) => standInScan(outDir)),
	builtFontsScan(fileURLToPath(new URL(`../${PUBLIC_DIR}`, import.meta.url))),
];
for (const scan of scans) {
	for (const line of scan.lines) (scan.ok ? process.stdout : process.stderr).write(`${line}\n`);
}

process.exit(scans.every((scan) => scan.ok) ? 0 : 1);
