/**
 * How a Release's descriptor is built: its `build` scripts, in order, in the
 * app's directory. The one build every Environment deploys, and the one CI's
 * Worker leg checks (`keepr-deploy build`, `check` and `deploy`).
 *
 * An app that binds Keepr Accounts is built beside the Accounts Stand-in
 * (ADR-0113, ADR-0121). Its build smokes the built Worker, which asks Keepr
 * Accounts who each request belongs to, and neither a deploy's build nor CI
 * has a Keepr Accounts to ask. The stand-in is the Release's own, started by
 * the launcher in its checkout, so it signs what that Release's Worker
 * verifies. It runs only for the length of a build script on the machine that
 * builds, and is never part of what the build leaves: reading a Release
 * refuses any descriptor that would deploy it (`release.mjs`).
 *
 * This is the tooling's one exception, with deploy order's (`order.mjs`), to
 * knowing no app: it knows Keepr Accounts' service by name, and where a
 * checkout keeps the stand-in.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { parseJsonc } from '../jsonc.mjs';
import { configBindsKeeprAccounts } from './order.mjs';

/** The Accounts Stand-in's launcher, from a checkout's root: `keepr-accounts-stand-in -- <command>`. */
export const STAND_IN_LAUNCHER = 'packages/accounts-stand-in/scripts/stand-in.mjs';

/**
 * Whether the app's Worker binds Keepr Accounts, read from the source
 * configuration its descriptor names: a build cannot read the built one it has
 * not made yet. An app whose source configuration is missing binds nothing.
 *
 * @param {Pick<import('./release.mjs').Release, 'appDir' | 'descriptor'>} release
 */
export function buildsBesideStandIn({ appDir, descriptor }) {
	const source = join(appDir, descriptor.worker.source ?? '');
	if (descriptor.worker.source === undefined || !existsSync(source)) return false;
	return configBindsKeeprAccounts(parseJsonc(readFileSync(source, 'utf8')));
}

/**
 * The command for each of the descriptor's build scripts, in order: `pnpm run
 * <script>`, through the Release's own stand-in launcher when its Worker binds
 * Keepr Accounts. An app that binds it in a checkout with no stand-in is
 * refused: its smoke would have nobody to ask, and fail without saying so.
 *
 * @param {Pick<import('./release.mjs').Release, 'appDir' | 'descriptor'>} release
 * @param {{ node?: string }} [options] `node`: the Node that runs the launcher.
 * @returns {{ command: string, args: string[] }[]}
 */
export function buildCommands(release, { node = process.execPath } = {}) {
	const scripts = release.descriptor.build.map((script) => ['pnpm', 'run', script]);
	if (!buildsBesideStandIn(release))
		return scripts.map(([command, ...args]) => ({
			command: /** @type {string} */ (command),
			args,
		}));
	// An app is `apps/<app>` from its checkout's root (`readRelease`).
	const launcher = resolve(release.appDir, '../..', STAND_IN_LAUNCHER);
	if (!existsSync(launcher))
		throw new Error(
			`${release.descriptor.app} binds Keepr Accounts, and this checkout has no Accounts Stand-in to build it beside (${STAND_IN_LAUNCHER}).`,
		);
	return scripts.map((script) => ({ command: node, args: [launcher, '--', ...script] }));
}
