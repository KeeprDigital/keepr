import type { ApplicationFontFaceRequest } from '~~/shared/modules/graphics/typography';
import type { ScreenGraphicAssetReference } from '~~/shared/utils/graphicsAssetReferences';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, h, reactive, ref } from 'vue';
import { deferred } from '@keepr/nuxt-layer/test/helpers/deferred';
import { createMockScreen } from '~~/test/helpers/fixtures';
import { testGraphicAssetReference } from '~~/test/helpers/graphicsAssetIdentities';
import {
	restoreDocumentFonts,
	stubDocumentFonts,
	stubFontFaces,
} from '~~/test/nuxt/helpers/fontFaces';
import RendererFrame from '~/components/Screen/RendererFrame.vue';
import { FONT_LOAD_TIMEOUT_MS } from '~/composables/screen/useApplicationFontFaces';
import { SCREEN_MODE_READY_TIMEOUT_MS, useScreenModeReady } from '~/modules/screen-mode/readiness';

/**
 * One Screen Mode rendering's frame: it says it is ready once its display has
 * declared, its fonts have settled and its media has loaded, or at the ready
 * timeout; and it hides its display, never its background, while a library
 * font loads (ADR-0053). The renderer's double-buffering is `Renderer.test.ts`'s.
 */

/** Whether the display declares its data settled. */
const state = reactive({ ready: true, pending: false });
const libraryFonts = ref<ScreenGraphicAssetReference[]>([]);
const applicationFonts = ref<ApplicationFontFaceRequest[]>([]);

const Display = defineComponent({
	setup() {
		useScreenModeReady(() => state.ready);
		return () =>
			h('div', {
				'data-testid': 'display',
				'data-render-pending': state.pending ? '' : undefined,
			});
	},
});

vi.mock('~/modules/screen-mode', async () => ({
	...(await vi.importActual<typeof import('~/modules/screen-mode/readiness')>(
		'~/modules/screen-mode/readiness',
	)),
	getScreenModeDefinition: () => ({ displayComponent: Display }),
	resolveScreenModeHost: () => ({
		containerClass: 'host-container',
		containerStyle: {},
		provideOverlayContainer: false,
	}),
	screenBackgroundLayers: () => [],
	screenModeThemeTokenStyle: () => ({}),
	screenModeThemeFontReferences: () => libraryFonts.value,
	screenModeThemeApplicationFonts: () => applicationFonts.value,
}));

// A preview resolves library content without a capability session.
mockNuxtImport('useScreenContext', () => () => ({
	screen: ref(createMockScreen({ currentMode: 'card' })),
	eventId: computed(() => 1),
	interactive: ref(false),
	overlayContainer: ref(null),
	isPreview: ref(true),
	themeTokens: ref(undefined),
	eventCanvas: ref({ width: 1280, height: 720 }),
}));

const mounted: Array<{ unmount: () => void }> = [];

function mountFrame() {
	const wrapper = mount(RendererFrame, {
		props: { mode: 'card', shown: true, viewportWidth: 1280, viewportHeight: 720 },
	});
	mounted.push(wrapper);
	return {
		ready: () => wrapper.get('[data-screen-mode]').attributes('data-screen-mode-ready') === 'true',
		emitted: () => wrapper.emitted('ready')?.length ?? 0,
		displayHidden: () =>
			(wrapper.get('.screen-renderer__display').element as HTMLElement).style.visibility ===
			'hidden',
	};
}

const libraryFont: ScreenGraphicAssetReference = {
	kind: 'font',
	ownerSlot: 'heading',
	reference: testGraphicAssetReference('font-asset', 'font-revision-1'),
};

describe('screenRendererFrame', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		state.ready = true;
		state.pending = false;
		libraryFonts.value = [];
		applicationFonts.value = [];
		stubDocumentFonts();
	});

	afterEach(() => {
		// Unmounted before the fonts are restored: unmounting takes its faces off them.
		for (const wrapper of mounted.splice(0)) wrapper.unmount();
		vi.useRealTimers();
		vi.unstubAllGlobals();
		restoreDocumentFonts();
	});

	// Each row holds back one thing readiness waits for that has no deadline of its own.
	it.each([
		{ row: 'its display has not declared', hold: () => (state.ready = false) },
		{ row: 'a part inside it is still loading', hold: () => (state.pending = true) },
	])('says it is ready once settled, or at the ready timeout while $row', async ({ hold }) => {
		hold();
		const frame = mountFrame();
		await vi.advanceTimersByTimeAsync(SCREEN_MODE_READY_TIMEOUT_MS - 1);
		const before = frame.ready();

		await vi.advanceTimersByTimeAsync(1);

		expect([before, frame.ready(), frame.emitted()]).toEqual([false, true, 1]);
	});

	it('says it is ready at once when nothing holds it', async () => {
		const frame = mountFrame();
		await vi.advanceTimersByTimeAsync(0);

		expect([frame.ready(), frame.emitted()]).toEqual([true, 1]);
	});

	describe('library fonts', () => {
		it('hides its display while a library font loads, and shows it once loaded', async () => {
			const load = deferred();
			stubFontFaces(async () => load.promise);
			libraryFonts.value = [libraryFont];
			const frame = mountFrame();
			await vi.advanceTimersByTimeAsync(0);
			const hiddenWhileLoading = frame.displayHidden();

			load.resolve();
			await vi.advanceTimersByTimeAsync(0);

			expect([hiddenWhileLoading, frame.displayHidden()]).toEqual([true, false]);
		});

		// A display hidden behind a load that never ends would go on air blank.
		it('shows its display in the fallback face once a library font load times out', async () => {
			stubFontFaces(async () => new Promise(() => {}));
			libraryFonts.value = [libraryFont];
			const frame = mountFrame();
			await vi.advanceTimersByTimeAsync(FONT_LOAD_TIMEOUT_MS - 1);
			const hiddenBefore = frame.displayHidden();

			await vi.advanceTimersByTimeAsync(1);

			expect([hiddenBefore, frame.displayHidden(), frame.ready()]).toEqual([true, false, true]);
		});
	});

	// The media wait ends on a Theme that may have changed meanwhile; its fonts must have settled too.
	it('holds readiness for a face its Theme comes to name while its media loaded', async () => {
		const poppins = deferred<unknown>();
		stubDocumentFonts(async () => poppins.promise);
		state.pending = true;
		const frame = mountFrame();
		await vi.advanceTimersByTimeAsync(0);

		applicationFonts.value = [{ fontId: 'poppins', weight: 700, style: 'normal' }];
		await vi.advanceTimersByTimeAsync(0);
		state.pending = false;
		await vi.advanceTimersByTimeAsync(0);
		const heldWhileLoading = frame.ready();

		poppins.resolve([{}]);
		await vi.advanceTimersByTimeAsync(0);

		expect([heldWhileLoading, frame.ready()]).toEqual([false, true]);
	});

	it('never hides its display for an application font', async () => {
		stubDocumentFonts(() => deferred<unknown>().promise);
		applicationFonts.value = [{ fontId: 'poppins', weight: 700, style: 'normal' }];
		const frame = mountFrame();
		await vi.advanceTimersByTimeAsync(0);

		expect([frame.displayHidden(), frame.ready()]).toEqual([false, false]);
	});
});
