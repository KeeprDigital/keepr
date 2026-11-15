import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isFourSeatFeatureMatchLayout } from '~~/shared/featureMatchLayoutSeats';

const mockUpdateModeConfig = vi.fn();
const mockToast = {
	add: vi.fn(),
};

const mockScreenStore = {
	screens: [
		{
			id: 1,
			modeConfigs: {
				'feature-match': { featureMatchId: 5 },
				// A Standings Page Rotation running from a manual selection of page 3.
				'standings': {
					autoPageEnabled: true,
					rowsPerPage: 4,
					currentPage: 3,
					rotationAnchor: 123,
				},
			},
		},
	],
	updateModeConfig: mockUpdateModeConfig,
};

mockNuxtImport('useScreenStore', () => () => mockScreenStore);
mockNuxtImport('useToast', () => () => mockToast);
const mockEventStore = {
	event: { game: 'mtg', variant: 'commander' } as { game: string; variant: string } | null,
};
mockNuxtImport('useEventStore', () => () => mockEventStore);

describe('useModeConfigUpdate', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		mockEventStore.event = { game: 'mtg', variant: 'commander' };
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('shows the stored config, then an edit at once, and saves the edit after the debounce', async () => {
		const { config, updateConfig } = useModeConfigUpdate(1, 1, 'feature-match', { debounceMs: 100 });
		expect(config.value.featureMatchId).toBe(5);

		updateConfig({ featureMatchId: 10 } as any);
		expect(config.value.featureMatchId).toBe(10);

		await vi.advanceTimersByTimeAsync(200);
		expect(mockUpdateModeConfig).toHaveBeenCalledWith(1, 1, 'feature-match', { featureMatchId: 10 });
	});

	it('a display reset of a paginated mode restarts its Page Rotation from page 1', async () => {
		const { resetConfig } = useModeConfigUpdate(1, 1, 'standings', { debounceMs: 100 });
		resetConfig();

		await vi.advanceTimersByTimeAsync(200);
		const written = mockUpdateModeConfig.mock.calls[0]![3];
		// Auto-page is off after a reset, so no Rotation Anchor is written.
		expect(written).toMatchObject({ autoPageEnabled: false, rowsPerPage: 8, currentPage: 1 });
		expect(written).not.toHaveProperty('rotationAnchor');
	});

	it('a display reset of a Feature Match Overlay lands on a layout its Event is offered', async () => {
		const { resetConfig } = useModeConfigUpdate(1, 1, 'feature-match-overlay', { debounceMs: 100 });
		resetConfig();

		await vi.advanceTimersByTimeAsync(200);
		expect(isFourSeatFeatureMatchLayout(mockUpdateModeConfig.mock.calls[0]![3].layout)).toBe(true);
	});

	// Which layout a Feature Match Overlay resets to depends on its Event, so the reset waits for it.
	it.each([
		{ mode: 'feature-match-overlay' as const, ready: false, writes: 0 },
		{ mode: 'standings' as const, ready: true, writes: 1 },
	])('a display reset of $mode before its Event loads is ready: $ready', async ({ mode, ready, writes }) => {
		mockEventStore.event = null;
		const { resetConfig, resetReady } = useModeConfigUpdate(1, 1, mode, { debounceMs: 100 });

		expect(resetReady.value).toBe(ready);
		resetConfig();
		await vi.advanceTimersByTimeAsync(200);
		expect(mockUpdateModeConfig).toHaveBeenCalledTimes(writes);
	});
});
