import { matchesGlob } from 'node:path';
import { describe, expect, it } from 'vitest';
import { rerunTriggers } from '../scripts/rerun-triggers.mjs';

const on = (...names: string[]) =>
	Object.fromEntries(names.map((name) => [`@keepr/${name}`, 'workspace:*']));

/** An app on a layer that is on a package of its own; another app beside it. */
const WORKSPACE = new Map(
	[
		{ name: '@keepr/app', dir: 'apps/app', dependencies: on('layer') },
		{ name: '@keepr/other', dir: 'apps/other', dependencies: on('layer') },
		{ name: '@keepr/layer', dir: 'packages/layer', dependencies: {}, devDependencies: on('base') },
		{ name: '@keepr/base', dir: 'packages/base', dependencies: {} },
	].map((pkg) => [pkg.name, pkg]),
);

const triggers = rerunTriggers(
	'@keepr/app',
	['**/package.json', '**/server/db/migrations/**'],
	WORKSPACE,
);

/** Vitest matches each changed file by its absolute path, in whatever directory the checkout is. */
const reruns = (file: string) =>
	triggers.some((trigger) => matchesGlob(`/home/someone/keepr/${file}`, trigger));

describe("which changed files run an app's whole suite under --changed", () => {
	it.each([
		["the app's own", 'apps/app/package.json', true],
		['a package it consumes, one through another', 'packages/base/package.json', true],
		['the lockfile, which installs every project', 'pnpm-lock.yaml', true],
		[
			"another app's, though it matches the pattern",
			'apps/other/server/db/migrations/0001.sql',
			false,
		],
		["a file of the app's that matches no pattern", 'apps/app/server/api/x.ts', false],
	])('%s: %s', (_case, file, expected) => {
		expect(reruns(file)).toBe(expected);
	});

	it('refuses a project the workspace does not have', () => {
		expect(() => rerunTriggers('@keepr/missing', ['**/package.json'], WORKSPACE)).toThrow(
			'@keepr/missing',
		);
	});
});
