// Where one run of `keepr-accounts-stand-in` registers the Accounts Stand-in, and
// what it tells the command it runs beside (`stand-in.mjs`).
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Wrangler's own name for the local registry a binding finds its Worker in. */
export const REGISTRY_ENV = 'WRANGLER_REGISTRY_PATH';

/**
 * The registry a stand-in already answers in, set for the command it runs
 * beside. A run inside that command which would register in the same registry
 * starts no second stand-in: Wrangler keeps the first of two Workers of one
 * name, and the second's end would take the name away.
 */
export const STAND_IN_REGISTRY_ENV = 'KEEPR_ACCOUNTS_STAND_IN_REGISTRY';

/** The name the stand-in registers under: Keepr Accounts' service name. */
export const STAND_IN_SERVICE = 'keepr-accounts';

/**
 * @typedef {{
 *   start: boolean,
 *   reason?: 'off' | 'nested',
 *   registry: string | undefined,
 *   env: Record<string, string>,
 *   dispose: () => void,
 * }} StandInRegistry
 *   `start`: whether this run starts a stand-in, and if not, why. `registry`:
 *   the directory it registers in, or `undefined` for Wrangler's default.
 *   `env`: what the stand-in and the command are given beside this process's
 *   environment. `dispose`: removes a registry this run made.
 */

/**
 * Decides where this run's stand-in registers.
 *
 * - `KEEPR_ACCOUNTS_STAND_IN=off`: none starts, and nothing is set.
 * - A registry named for this run, where a stand-in already answers: none starts.
 * - A registry named for this run: the stand-in registers there.
 * - Beside a command, with none named: a registry of this run's own, removed when it ends.
 * - Alone, with none named: Wrangler's default, where an App started apart finds it.
 *
 * @param {{
 *   env: Record<string, string | undefined>,
 *   besideCommand: boolean,
 *   makeDirectory?: () => string,
 * }} options
 * @returns {StandInRegistry}
 */
export function standInRegistry({
	env,
	besideCommand,
	makeDirectory = () => mkdtempSync(join(tmpdir(), 'keepr-accounts-stand-in-registry-')),
}) {
	const nothing = { registry: undefined, env: {}, dispose() {} };
	if (env.KEEPR_ACCOUNTS_STAND_IN === 'off') return { start: false, reason: 'off', ...nothing };
	const named = env[REGISTRY_ENV] || undefined;
	if (named !== undefined && env[STAND_IN_REGISTRY_ENV] === named)
		return { start: false, reason: 'nested', ...nothing, registry: named };
	if (named !== undefined)
		return {
			start: true,
			registry: named,
			env: { [STAND_IN_REGISTRY_ENV]: named },
			dispose() {},
		};
	if (!besideCommand) return { start: true, ...nothing };
	const registry = makeDirectory();
	return {
		start: true,
		registry,
		env: { [REGISTRY_ENV]: registry, [STAND_IN_REGISTRY_ENV]: registry },
		dispose: () => rmSync(registry, { recursive: true, force: true }),
	};
}

/**
 * Waits until the stand-in is registered in `registry`: Wrangler writes a file
 * there named for the Worker. Answers whether it registered before `stopped`
 * said to give up, or the time ran out.
 *
 * @param {string} registry
 * @param {{ stopped?: () => boolean, timeoutMs?: number, intervalMs?: number }} [options]
 * @returns {Promise<boolean>}
 */
export async function untilRegistered(
	registry,
	{ stopped = () => false, timeoutMs = 60_000, intervalMs = 50 } = {},
) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (existsSync(join(registry, STAND_IN_SERVICE))) return true;
		if (stopped()) return false;
		await new Promise((resolve) => setTimeout(resolve, intervalMs));
	}
	return false;
}
