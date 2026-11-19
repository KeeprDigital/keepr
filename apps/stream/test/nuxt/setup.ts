/**
 * Shared setup for every Nuxt-environment suite (#367). The app's three background
 * writers through `$fetch` — `useServerTime`'s clock sync, the realtime plugin's
 * token mint and the page gate's "who am I" — are stubbed here, so a suite's
 * `$fetch` mock records only the suite's own requests. `test/nuxt/setup.test.ts`
 * holds this file to that contract.
 *
 * A suite that tests a stubbed surface takes the stub off in its own file, which
 * registers later and wins (`vi.unmock('@keepr/nuxt-layer/app/composables/core/useServerTime')`,
 * `vi.unmock('~/modules/access/session')`, or its own `vi.mock('ably')`).
 *
 * The factories import nothing on purpose: `mockNuxtImport` would eagerly import the
 * mocked module, instantiating the app graph before the suite's own `$fetch` mock exists.
 */

import { vi } from 'vitest';
import { readonly, ref } from 'vue';

/** Never synced, offset zero: the state every suite saw against a mocked `$fetch`. */
vi.mock('@keepr/nuxt-layer/app/composables/core/useServerTime', () => {
	const serverTimeOffset = readonly(ref(0));
	const isSynced = readonly(ref(false));
	const lastSyncedAt = readonly(ref<number | null>(null));

	return {
		useServerTime: () => ({
			serverTimeOffset,
			isSynced,
			lastSyncedAt,
			getServerTime: () => Date.now(),
			deviceDelayFor: (serverMs: number) => serverMs,
			sync: async () => {},
			startSync: () => {},
			stopSync: () => {},
		}),
	};
});

/**
 * A browser the page gate already recognises. Every navigation in a suite runs
 * the gate (`app/middleware/access.global.ts`), which would otherwise ask the
 * suite's `$fetch` mock who the browser is: an answer of nothing reads as
 * unknown, and a blanket 401 as a signed-out visitor to send to Keepr Accounts.
 */
vi.mock('~/modules/access/session', () => {
	const identity = readonly(
		ref({
			app: 'stream',
			user: { id: 'test-operator', email: 'operator@example.test', name: 'Test Operator' },
			sessionId: 'test-session',
			organisation: null,
			appRole: 'admin',
			keeprAdministrator: false,
		}),
	);

	return {
		useAccess: () => ({
			identity,
			ensure: async () => 'signed-in',
			load: async () => 'signed-in',
		}),
	};
});

/** An Ably that never connects and never fetches a token; channels and presence accept calls inertly. */
vi.mock('ably', () => {
	class InertChannel {
		presence = {
			enter: async () => {},
			leave: async () => {},
			get: async () => [],
			subscribe: () => {},
			unsubscribe: () => {},
		};

		subscribe() {}
		unsubscribe() {}
		on() {}
		async detach() {}
	}

	class InertClient {
		auth = {
			authorize: async () => ({}),
		};

		connection = {
			id: 'test-connection',
			state: 'initialized',
			on: () => {},
			connect: () => {},
			close: () => {},
		};

		channels = {
			cache: new Map<string, InertChannel>(),
			get(name: string) {
				if (!this.cache.has(name)) this.cache.set(name, new InertChannel());
				return this.cache.get(name)!;
			},
		};
	}

	return {
		default: { Realtime: InertClient, Rest: InertClient },
	};
});
