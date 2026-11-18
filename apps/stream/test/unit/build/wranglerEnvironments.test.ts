import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { unstable_readConfig } from 'wrangler';
import { parseJsonc } from '@keepr/tooling/scripts/jsonc.mjs';

/*
 * Each Environment deploys the one build with its own `env` block (ADR-0119),
 * and Wrangler does not inherit bindings into one: an Environment must bind
 * every kind and name production binds, under the Worker names production uses.
 */

const descriptor = parseJsonc(readFileSync('deploy.jsonc', 'utf8')) as {
	environments: Record<string, { url: string; wranglerEnv?: string }>;
	parts: Record<string, { config: string }>;
};

const NAMED_ENVIRONMENTS = Object.entries(descriptor.environments).filter(
	(entry): entry is [string, { url: string; wranglerEnv: string }] =>
		entry[1].wranglerEnv !== undefined,
);

const WORKERS = [
	// Nitro names the app's Worker in the built config; its env block names it itself.
	{ config: 'wrangler.jsonc', name: 'stream' },
	{ config: descriptor.parts.validator!.config, name: 'stream-silent-video-validator' },
];

type Resolved = ReturnType<typeof unstable_readConfig>;

/**
 * Wrangler's own resolution, the one `wrangler deploy --env` uploads. Wrangler
 * falls back to the top level for an `env` it does not find, so that refuses here.
 */
function resolve(config: string, wranglerEnv?: string): Resolved {
	const resolved = unstable_readConfig({ config, env: wranglerEnv }, { hideWarnings: true });
	if (wranglerEnv !== undefined && !resolved.definedEnvironments?.includes(wranglerEnv))
		throw new Error(`${config} has no env.${wranglerEnv} block`);
	return resolved;
}

/**
 * What a configuration binds, without what an Environment sets for itself: each
 * binding's name (or class, or tag) and each var's key, but no id, bucket or value.
 */
function bound(value: unknown): unknown {
	if (Array.isArray(value))
		return value.map((item) =>
			item !== null && typeof item === 'object'
				? ((item as Record<string, unknown>).binding ??
					(item as Record<string, unknown>).name ??
					(item as Record<string, unknown>).class_name ??
					(item as Record<string, unknown>).tag ??
					bound(item))
				: item,
		);
	if (value !== null && typeof value === 'object')
		return Object.fromEntries(
			Object.entries(value).map(([key, nested]) => [
				key,
				nested !== null && typeof nested === 'object' ? bound(nested) : true,
			]),
		);
	return value;
}

/** Each Environment names its Worker and its host; the rest is where it was read from. */
const ENVIRONMENT_OWN = new Set([
	'name',
	'routes',
	'configPath',
	'userConfigPath',
	'topLevelName',
	'definedEnvironments',
	'targetEnvironment',
]);

function bindings(config: Resolved) {
	return Object.fromEntries(
		Object.entries(config)
			.filter(([key]) => !ENVIRONMENT_OWN.has(key))
			.map(([key, value]) => [key, bound(value)]),
	);
}

const customDomains = (config: Resolved) =>
	(config.routes ?? []).flatMap((route) =>
		typeof route === 'object' && 'custom_domain' in route && route.custom_domain
			? [route.pattern]
			: [],
	);

describe.each(NAMED_ENVIRONMENTS)('the %s Environment', (_environment, { url, wranglerEnv }) => {
	it.each(WORKERS)('binds what production binds, for $config', ({ config }) => {
		expect(bindings(resolve(config, wranglerEnv))).toEqual(bindings(resolve(config)));
	});

	it.each(WORKERS)('deploys the Worker $name, as production does', ({ config, name }) => {
		expect(resolve(config, wranglerEnv).name).toBe(name);
	});

	it("attaches its descriptor's host to the app's Worker, and not production's", () => {
		expect(customDomains(resolve('wrangler.jsonc', wranglerEnv))).toEqual([new URL(url).host]);
	});
});

it("attaches production's descriptor host to production's Worker", () => {
	expect(customDomains(resolve('wrangler.jsonc'))).toEqual([
		new URL(descriptor.environments.production!.url).host,
	]);
});
