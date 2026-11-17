import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { undeployableReason } from '../scripts/deploy-guard.mjs';

const guard = fileURLToPath(new URL('../scripts/deploy-guard.mjs', import.meta.url));
const standInConfig = fileURLToPath(
	new URL('../../accounts-stand-in/stand-in.wrangler.jsonc', import.meta.url),
);

// A Wrangler configuration is refused for deploy when the package it belongs to says
// it must never be deployed: the Accounts Stand-in above all (ADR-0113).
describe('the deploy guard', () => {
	const directories: string[] = [];

	afterEach(() => {
		for (const directory of directories.splice(0))
			rmSync(directory, { recursive: true, force: true });
	});

	/** A package holding a built Worker's configuration, as `.output/server/wrangler.json`. */
	function packageWithConfig(packageJson: Record<string, unknown>) {
		const root = mkdtempSync(join(tmpdir(), 'deploy-guard-'));
		directories.push(root);
		writeFileSync(join(root, 'package.json'), JSON.stringify(packageJson));
		mkdirSync(join(root, '.output/server'), { recursive: true });
		const config = join(root, '.output/server/wrangler.json');
		writeFileSync(config, JSON.stringify({ name: 'keepr-accounts' }));
		return config;
	}

	it('refuses the Accounts Stand-in, naming why', () => {
		expect(undeployableReason(standInConfig)).toContain('Local Developer User');
	});

	it.each([
		[
			'a package marked undeployable',
			{ keepr: { undeployable: 'never ship this' } },
			'never ship this',
		],
		['an ordinary package', { name: '@keepr/accounts' }, undefined],
	])('for %s answers %s', (_case, packageJson, reason) => {
		expect(undeployableReason(packageWithConfig(packageJson))).toBe(reason);
	});

	it.each([
		['refuses, exiting 1', standInConfig, 1],
		['admits, exiting 0', null, 0],
	])('as a command, %s', (_case, config, status) => {
		const path = config ?? packageWithConfig({ name: '@keepr/accounts' });
		let exitStatus = 0;
		try {
			execFileSync(process.execPath, [guard, path], { stdio: 'ignore' });
		} catch (error) {
			exitStatus = (error as { status: number }).status;
		}
		expect(exitStatus).toBe(status);
	});
});
