import { describe, expect, it } from 'vitest';

/*
 * An app's Wrangler configurations against its deploy descriptor. Each
 * Environment deploys the one build with its own `env` block (ADR-0119), and
 * Wrangler does not inherit bindings into one: an Environment must bind every
 * kind and name production binds, under the Worker names production uses, in
 * an account of its own (ADR-0122, ADR-0130), at its descriptor's host.
 */

/** What Wrangler resolves a configuration to: `unstable_readConfig`'s answer, as far as this reads it. */
export interface ResolvedWranglerConfig {
	name?: string;
	account_id?: string;
	routes?: unknown[];
	definedEnvironments?: string[];
	[key: string]: unknown;
}

/** Wrangler's own resolution (`unstable_readConfig` from `wrangler`), which the app passes in. */
export type ReadWranglerConfig = (
	args: { config: string; env?: string },
	options: { hideWarnings: boolean },
) => ResolvedWranglerConfig;

/** A Worker the app deploys: its configuration's path from the app, and the name it deploys as. */
export interface DeployedWorker {
	config: string;
	name: string;
}

/** What this reads of the app's deploy descriptor (`deploy.jsonc`). */
export interface DeployDescriptorEnvironments {
	environments: Record<string, { url: string; wranglerEnv?: string }>;
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

/** Each Environment names its account, Worker and host; the rest is where it was read from. */
const ENVIRONMENT_OWN = new Set([
	'account_id',
	'name',
	'routes',
	'configPath',
	'userConfigPath',
	'topLevelName',
	'definedEnvironments',
	'targetEnvironment',
]);

function bindings(config: ResolvedWranglerConfig) {
	return Object.fromEntries(
		Object.entries(config)
			.filter(([key]) => !ENVIRONMENT_OWN.has(key))
			.map(([key, value]) => [key, bound(value)]),
	);
}

const customDomains = (config: ResolvedWranglerConfig) =>
	((config.routes ?? []) as (string | { pattern: string; custom_domain?: boolean })[]).flatMap(
		(route) => (typeof route === 'object' && route.custom_domain ? [route.pattern] : []),
	);

/**
 * The tests that hold an app's Wrangler configurations, by their paths from the
 * working directory, to its deploy descriptor. `workers[0]` is the app's own
 * Worker, whose custom domain is the descriptor's host.
 */
export function describeWranglerEnvironments({
	descriptor,
	readConfig,
	workers,
}: {
	descriptor: DeployDescriptorEnvironments;
	readConfig: ReadWranglerConfig;
	workers: [DeployedWorker, ...DeployedWorker[]];
}) {
	const appWorker = workers[0];

	/** Wrangler falls back to the top level for an `env` it does not find, so that refuses here. */
	const resolve = (config: string, wranglerEnv?: string) => {
		const resolved = readConfig({ config, env: wranglerEnv }, { hideWarnings: true });
		if (wranglerEnv !== undefined && !resolved.definedEnvironments?.includes(wranglerEnv))
			throw new Error(`${config} has no env.${wranglerEnv} block`);
		return resolved;
	};

	const namedEnvironments = Object.entries(descriptor.environments).filter(
		(entry): entry is [string, { url: string; wranglerEnv: string }] =>
			entry[1].wranglerEnv !== undefined,
	);

	describe.each(namedEnvironments)('the %s Environment', (_environment, { url, wranglerEnv }) => {
		it.each(workers)('binds what production binds, for $config', ({ config }) => {
			expect(bindings(resolve(config, wranglerEnv))).toEqual(bindings(resolve(config)));
		});

		it.each(workers)('deploys the Worker $name, as production does', ({ config, name }) => {
			expect(resolve(config, wranglerEnv).name).toBe(name);
		});

		// The configs name the account, so every Wrangler command reaches it with no export (ADR-0130).
		it("deploys every Worker to one account of its own, not production's", () => {
			const accounts = workers.map(({ config }) => resolve(config, wranglerEnv).account_id);

			expect(new Set(accounts).size).toBe(1);
			expect(accounts[0]).toMatch(/^[0-9a-f]{32}$/);
			expect(accounts[0]).not.toBe(resolve(appWorker.config).account_id);
		});

		it("attaches its descriptor's host to the app's Worker, and not production's", () => {
			expect(customDomains(resolve(appWorker.config, wranglerEnv))).toEqual([new URL(url).host]);
		});
	});

	it("deploys every one of production's Workers to the one account their configs name", () => {
		const accounts = workers.map(({ config }) => resolve(config).account_id);

		expect(new Set(accounts).size).toBe(1);
		expect(accounts[0]).toMatch(/^[0-9a-f]{32}$/);
	});

	it("attaches production's descriptor host to production's Worker", () => {
		expect(customDomains(resolve(appWorker.config))).toEqual([
			new URL(descriptor.environments.production!.url).host,
		]);
	});
}
