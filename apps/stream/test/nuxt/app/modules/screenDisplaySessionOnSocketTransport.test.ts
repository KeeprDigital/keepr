import type { SocketRealtimeRig } from '~~/test/helpers/realtimeSocketFake';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, reactive } from 'vue';
import { createMockScreen } from '~~/test/helpers/fixtures';
import { socketRealtimeRig } from '~~/test/helpers/realtimeSocketFake';
import { useScreenDisplaySession } from '~/modules/screen/displaySession';

/**
 * The display session's wiring to the realtime transport over an Event's
 * object. Its rules are tested at its home, on a stand-in transport
 * (`screenDisplaySession.test.ts`); this says what a Screen Output's own
 * subscribing and disposing costs it in sockets, each of which is a ticket
 * fetched (ADR-0137).
 */

const transport = vi.hoisted(() => ({ rig: null as SocketRealtimeRig | null }));

// The Screen's realtime session, which enters presence and hears commands, takes the app's transport.
mockNuxtImport('useRealtime', () => () => transport.rig!.realtime);

function flushPromises() {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

/** A Screen Output of Event 42, on its `main` Screen. */
function screenOutput() {
	const rig = socketRealtimeRig();
	transport.rig = rig;
	const route = reactive({ params: { eventId: '42', screenSlug: 'main' }, query: {}, hash: '' });
	const screens = [
		createMockScreen({ id: 7, slug: 'main' }),
		createMockScreen({ id: 8, slug: 'second' }),
	];
	const screenStore = reactive({
		activeScreen: null as (typeof screens)[number] | null,
		loadScreenBySlug: async (_eventId: number, slug: string) =>
			(screenStore.activeScreen = screens.find((screen) => screen.slug === slug) ?? null),
		refreshActiveScreen: async (_eventId: number, screenId: number) =>
			(screenStore.activeScreen = screens.find((screen) => screen.id === screenId) ?? null),
	});
	const eventStore = reactive({
		eventId: null,
		outputEvent: null as unknown,
		setOutputEvent(outputEvent: unknown) {
			eventStore.outputEvent = outputEvent;
		},
	});
	const wrapper = mount(
		defineComponent({
			setup() {
				useScreenDisplaySession({
					route: route as never,
					eventStore: eventStore as never,
					screenStore: screenStore as never,
					realtime: rig.realtime,
					outputReads: {
						event: async (scope) => ({ id: scope.eventId, name: 'Output Event' }) as never,
					},
				});
				return () => h('div');
			},
		}),
	);
	return { ...rig, route, wrapper };
}

describe('a Screen Output, on the realtime transport over an Event’s object', () => {
	afterEach(() => {
		transport.rig?.realtime.dispose();
		transport.rig = null;
	});

	it('asks for no new address when it changes Screen within its Event', async () => {
		const { route, asked, sockets, open, wrapper } = screenOutput();
		await flushPromises();
		const socket = await open(42, 'screen:42:7');
		await flushPromises();

		route.params.screenSlug = 'second';
		await flushPromises();

		// On its one socket it left the Screen it was on and is on the next.
		expect(socket.frames.slice(1).filter((frame) => frame.t !== 'attach')).toEqual([
			{ t: 'leave', channel: 'screen:42:7' },
			{ t: 'detach', channel: 'screen:42:7' },
			expect.objectContaining({ t: 'enter', channel: 'screen:42:8' }),
		]);
		expect(socket.closed).toBe(false);
		expect(sockets).toHaveLength(1);
		expect(asked).toEqual([42]);
		wrapper.unmount();
	});
});
