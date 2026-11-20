import type { ScreenCard } from '~~/shared/types/card/mtg';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useActiveCardScreenRuntime } from '~/modules/card-screen/activeCard';
import { useProjectedRotationPage } from '~/modules/screen-mode/pagination';

/**
 * Clock-driven behaviour on the real `useServerTime`, with only the network
 * faked: `/api/time` answers from a server whose clock runs ahead of this
 * device's, so a change timed on the device's clock lands at the wrong moment.
 */

const SERVER_AHEAD_MS = 30_000;

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));
mockNuxtImport('$fetch', () => mockFetch);
// test/nuxt/setup.ts stubs `useServerTime` for every suite; these run on the real one.
vi.unmock('@keepr/nuxt-layer/app/composables/core/useServerTime');

mockNuxtImport('useCardRepository', () => () => ({
	saveScreenCard: vi.fn(),
	getScreenCard: vi.fn(),
	deleteScreenCard: vi.fn(),
}));

/** The server's clock, which the fake `/api/time` answers at once. */
const serverNow = () => Date.now() + SERVER_AHEAD_MS;

const scopes: ReturnType<typeof effectScope>[] = [];
function inScope<T>(setup: () => T): T {
	const scope = effectScope();
	scopes.push(scope);
	return scope.run(setup)!;
}

/** Lets the shared clock's first sync land, on this test's fake clock. */
async function syncServerTime() {
	useServerTime().stopSync();
	useServerTime();
	await vi.advanceTimersByTimeAsync(1_000);
	expect(useServerTime().isSynced.value).toBe(true);
}

describe('clock-driven behaviour on server time', () => {
	beforeEach(() => {
		vi.useFakeTimers({ now: 1_000_000 });
		mockFetch.mockImplementation(async () => ({ serverTime: serverNow() }));
	});

	afterEach(() => {
		scopes.splice(0).forEach((scope) => scope.stop());
		useServerTime().stopSync();
		vi.useRealTimers();
	});

	// Every rendering flips together because each flips on server time, not its own clock.
	it("flips a Page Rotation at the server's boundary, not the device's", async () => {
		await syncServerTime();
		// Anchored by the server 15 s ago, with 10 s pages: 5 s into page 2 of 3.
		const page = inScope(() =>
			useProjectedRotationPage({
				autoPageEnabled: computed(() => true),
				autoPageIntervalMs: computed(() => 10_000),
				rotationAnchor: computed(() => serverNow() - 15_000),
				totalPages: computed(() => 3),
			}),
		);
		expect(page.value).toBe(2);

		await vi.advanceTimersByTimeAsync(4_999);
		expect(page.value).toBe(2);
		await vi.advanceTimersByTimeAsync(1);
		expect(page.value).toBe(3);
	});

	// A Card Timeout is stamped in server time, so a device behind the server hides it on the server's moment.
	it("hides a timed Card as server time reaches its expiry, not the device's clock", async () => {
		await syncServerTime();
		const activeCard = ref<ScreenCard | null>(null);
		const runtime = inScope(() =>
			useActiveCardScreenRuntime({
				eventId: 1,
				activeScreenId: ref(5),
				activeCard,
				timeout: { reset: () => {}, start: () => {} },
				loading: ref(false),
				error: ref(null),
				executeAction: (async (action: () => Promise<unknown>) => action()) as never,
			}),
		);
		// Shown by the server 59 s ago with a 60 s timeout: one second is left.
		const card = {
			id: 'card-1',
			name: 'Lightning Bolt',
			timeoutData: { timeoutStartTimestamp: serverNow() - 59_000, timeoutDuration: 60_000 },
		} as unknown as ScreenCard;

		runtime.applyRemoteUpdated({ eventId: 1, screenId: 5, card, revision: 1 } as never);
		expect(activeCard.value).toEqual(card);

		await vi.advanceTimersByTimeAsync(999);
		expect(activeCard.value).toEqual(card);
		await vi.advanceTimersByTimeAsync(1);
		expect(activeCard.value).toBeNull();
	});
});
