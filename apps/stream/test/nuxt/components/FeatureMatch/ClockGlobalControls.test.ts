import type { BulkClockAction } from '~~/shared/types/enums';
import type { FeatureMatchState } from '~~/shared/types/featureMatchState';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyFeatureMatchClockCommand } from '~~/shared/modules/feature-match-session';
import { createMockFeatureMatchState } from '~~/test/helpers/fixtures';
import {
	clock,
	commandResult,
	createSession,
	EVENT_ID,
	SERVER_NOW,
	sessionClient,
} from '~~/test/nuxt/helpers/featureMatchStateHarness';
import { nuxtUiStubs } from '@keepr/nuxt-layer/test/nuxt/helpers/nuxtUiStubs';
import ClockGlobalControls from '~/components/FeatureMatch/ClockGlobalControls.vue';

vi.mock('~/modules/feature-match-session/client', async () => {
	const { sessionClient } = await import('~~/test/nuxt/helpers/featureMatchSessionClientMock');
	return { useFeatureMatchSessionClient: () => sessionClient };
});

mockNuxtImport('useServerTime', () => () => ({ getServerTime: () => SERVER_NOW }));
mockNuxtImport('useEventStore', () => () => ({ eventId: EVENT_ID }));
mockNuxtImport('useFeatureMatchStore', () => () => ({
	featureMatches: [{ id: 100 }, { id: 200 }, { id: 300 }],
}));

const COMMANDS = {
	start: 'StartClock',
	pause: 'PauseClock',
	reset: 'ResetClock',
} as const satisfies Partial<Record<BulkClockAction, string>>;

/** Two timed Slots and an untimed one, as the server holds them; it answers a bulk action for the timed two. */
function serveSlots(timed: FeatureMatchState['clock']) {
	const store = useFeatureMatchStateStore();
	const held = new Map<number, FeatureMatchState>([
		[100, createMockFeatureMatchState({ clock: timed })],
		[200, createMockFeatureMatchState({ clock: timed })],
		[300, createMockFeatureMatchState({ clock: clock({ type: 'untimed' }) })],
	]);
	for (const [slotId, state] of held)
		store.cacheSession(createSession(state, { id: slotId * 10, slotId }));
	sessionClient.bulkClockAction.mockImplementation(
		async (_eventId: number, action: keyof typeof COMMANDS) => ({
			updates: [100, 200].map((slotId) => {
				const state = applyFeatureMatchClockCommand(held.get(slotId)!, COMMANDS[action], {
					at: SERVER_NOW,
				});
				return commandResult(state, { id: slotId * 10, slotId, sequence: 4 });
			}),
		}),
	);
}

function mountControls() {
	return mount(ClockGlobalControls, {
		global: {
			stubs: {
				...nuxtUiStubs,
				UDashboardToolbar: {
					template: '<div><slot name="left" /><slot name="right" /></div>',
				},
			},
		},
	});
}

function button(wrapper: ReturnType<typeof mountControls>, label: string) {
	return wrapper.findAll('button').find((candidate) => candidate.text() === label)!;
}

describe('the bulk clock controls', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		useFeatureMatchStateStore().$reset();
	});

	it.each([
		['Start All', clock(), '2 of 2 running'],
		['Pause All', clock({ isRunning: true, lastStartedAt: SERVER_NOW - 60_000 }), '2 of 2 paused'],
		['Reset All', clock({ elapsedMs: 60_000 }), '2 clocks idle'],
	])('%s acts on every timed clock, leaving the untimed one out', async (label, timed, shown) => {
		serveSlots(timed);
		const wrapper = mountControls();

		await button(wrapper, label).trigger('click');
		await flushPromises();

		expect(wrapper.text()).toContain(shown);
		expect(useFeatureMatchStateStore().featureMatchStates.get(300)?.clock.type).toBe('untimed');
	});
});
