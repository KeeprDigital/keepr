#!/usr/bin/env node
/**
 * keepr-secrets-sync, run as `pnpm secrets:sync` from anywhere in a checkout:
 * sets an Installation's Worker secrets or a GitHub environment's secrets from
 * 1Password (`sync.mjs`, ADR-0134). It needs `op` signed in to the `Keepr`
 * vault, and `wrangler login` or `gh auth login` for the destination.
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { syncSecrets } from './sync.mjs';

const USAGE = `usage: pnpm secrets:sync --app <app> --env <environment> [--check] [--generate <NAME>]...
       pnpm secrets:sync --github <environment> [--check]
  --app, --env       the app's Installation in that Environment: its Worker's secrets
  --github           a GitHub environment's secrets
  --check            set nothing; name what is missing there or in 1Password
  --generate <NAME>  a new random value for NAME, written into 1Password, then synced;
                     once per secret, and only for one the secrets map lets be generated`;

/** @param {string} cwd */
function workspaceRoot(cwd) {
	for (let directory = resolve(cwd); ; directory = dirname(directory)) {
		if (existsSync(join(directory, 'pnpm-workspace.yaml'))) return directory;
		if (dirname(directory) === directory) throw new Error(`${cwd} is not inside a pnpm workspace.`);
	}
}

/**
 * @param {string[]} argv
 * @param {{ cwd?: string }} [options]
 * @returns {number} the exit code
 */
export function main(argv, { cwd = process.cwd() } = {}) {
	let values;
	try {
		({ values } = parseArgs({
			args: argv,
			strict: true,
			options: {
				app: { type: 'string' },
				env: { type: 'string' },
				github: { type: 'string' },
				check: { type: 'boolean', default: false },
				generate: { type: 'string', multiple: true, default: [] },
			},
		}));
	} catch (error) {
		console.error(`${/** @type {Error} */ (error).message}\n${USAGE}`);
		return 2;
	}
	const { app, env: environment, github, check, generate } = values;
	const installation = app !== undefined && environment !== undefined;
	if (
		installation === (github !== undefined) ||
		(!installation && (app ?? environment) !== undefined)
	) {
		console.error(USAGE);
		return 2;
	}
	try {
		const { ok } = syncSecrets({
			root: workspaceRoot(cwd),
			target: installation ? { app, environment } : { github: /** @type {string} */ (github) },
			check,
			generate,
			log: (line) => console.log(line),
		});
		return ok ? 0 : 1;
	} catch (error) {
		console.error(/** @type {Error} */ (error).message);
		return 1;
	}
}

// `import.meta.main`: run as a workspace bin, `argv[1]` names the linked path.
if (import.meta.main) process.exitCode = main(process.argv.slice(2));
