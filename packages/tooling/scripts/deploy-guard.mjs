#!/usr/bin/env node
/**
 * keepr-deploy-guard <wrangler configuration>
 *
 * Refuses to deploy a Worker whose package says it must never be deployed, by a
 * `keepr.undeployable` sentence in its `package.json`: the nearest one above the
 * configuration. Reading a Release to deploy (`deploy/release.mjs`) runs it on
 * every configuration the app's deploy descriptor would upload, before anything
 * is built.
 *
 * The Accounts Stand-in carries the mark. It registers under Keepr Accounts'
 * service name, `keepr-accounts`, and signs every request in as a Keepr
 * Administrator: deployed, it would replace Keepr Accounts and admit anyone
 * (ADR-0113).
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/**
 * Why the Worker configured at `configPath` must never be deployed, or
 * `undefined` when nothing says so.
 *
 * @param {string} configPath
 * @returns {string | undefined}
 */
export function undeployableReason(configPath) {
	let directory = dirname(resolve(configPath));
	for (;;) {
		const manifest = join(directory, 'package.json');
		if (existsSync(manifest)) {
			const reason = JSON.parse(readFileSync(manifest, 'utf8'))?.keepr?.undeployable;
			return typeof reason === 'string' ? reason : undefined;
		}
		const parent = dirname(directory);
		if (parent === directory) return undefined;
		directory = parent;
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const configPath = process.argv[2];
	if (!configPath) {
		console.error('usage: keepr-deploy-guard <wrangler configuration>');
		process.exit(2);
	}
	const reason = undeployableReason(configPath);
	if (reason) {
		console.error(`[deploy-guard] Refusing to deploy ${configPath}: ${reason}`);
		process.exit(1);
	}
}
