/**
 * Shared setup for every Nuxt-environment suite (#367). The app's background
 * writers through `$fetch` — `useServerTime`'s clock sync, the page gate's "who
 * am I" and a Screen Output's realtime ticket — are stubbed here, so a suite's
 * `$fetch` mock records only the suite's own requests, and the realtime plugin
 * opens no socket. `test/nuxt/setup.test.ts` holds this file to that contract.
 *
 * A suite that tests a stubbed surface takes the stub off in its own file, which
 * registers later and wins (`vi.unmock('@keepr/nuxt-layer/app/composables/core/useServerTime')`,
 * `vi.unmock('~/modules/access/session')`, `vi.unmock('@keepr/realtime/client')`).
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
	const doubt = readonly(ref(null));
	const lastSyncedAt = readonly(ref<number | null>(null));

	return {
		useServerTime: () => ({
			serverTimeOffset,
			isSynced,
			doubt,
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

/**
 * A client transport that never connects: it opens no socket and asks for no
 * address, so a Screen Output's page fetches no ticket, and everything asked of
 * it is accepted inertly. The app's own transport runs over it
 * (`app/modules/realtime-transport/socketTransport.ts`) and stands by,
 * `initialized`, as on a page that is on no Event.
 */
vi.mock('@keepr/realtime/client', () => {
	const nothing = () => {};

	return {
		RefusedError: class RefusedError extends Error {},
		checkOnPageEvents: () => nothing,
		createSocketTransport: () => ({
			clientId: 'test-client',
			connectionState: 'closed',
			isConnected: false,
			connectionId: undefined,
			error: null,
			refusal: null,
			channelRefusals: [],
			onChange: () => nothing,
			checkNow: nothing,
			onMessage: () => nothing,
			onContinuityLost: () => nothing,
			onceAttached: () => nothing,
			enterPresence: nothing,
			updatePresence: nothing,
			leavePresence: nothing,
			watchPresence: () => nothing,
			hold: () => nothing,
			dispose: nothing,
		}),
	};
});
