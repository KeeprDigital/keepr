import type { VueWrapper } from '@vue/test-utils';
import type { Game, ScreenMode, Variant } from '~~/shared/types/enums';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventKind, isOfferedToEvent } from '~~/shared/config/games';
import {
	BACKGROUND_LAYERS_CAPABLE_MODES,
	SCREEN_MODES,
	THEME_PREVIEW_SCREEN_MODES,
} from '~~/shared/screenModes';
import { settleUntil } from '@keepr/nuxt-layer/test/helpers/settle';
import { loadDrawnImages } from '~~/test/nuxt/helpers/drawnImages';
import { stubImageLoading } from '~~/test/nuxt/helpers/imageLoading';
import PreviewTile from '~/components/Theme/PreviewTile.vue';

// Each Card Game's Screen Mode Sample Dataset, and a Commander Event's, fills every plain overlay and Theme
// preview mode its Events are offered, so a newly themed mode previews unchanged,
// and fills them alone: a preview makes no request, not even for card data.

const { mockFetch } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
}));
mockNuxtImport('$fetch', () => mockFetch);
const browserFetch = vi.fn();

let wrapper: VueWrapper | undefined;

beforeEach(() => {
	vi.stubGlobal('fetch', browserFetch);
});

afterEach(() => {
	wrapper?.unmount();
	wrapper = undefined;
	mockFetch.mockReset();
	browserFetch.mockReset();
	vi.unstubAllGlobals();
});

type Shown = (rendering: VueWrapper) => boolean;
const text =
	(shown: string): Shown =>
	(rendering) =>
		rendering.text().includes(shown);
const deckCard =
	(name: string): Shown =>
	(rendering) =>
		rendering.find(`img[alt="${name}"]`).exists();

const opCard =
	(number: string): Shown =>
	(rendering) =>
		rendering.find(`[data-testid="op-deck-card"][data-number="${number}"] img`).exists();
function inSection(section: string, name: string): Shown {
	return (rendering) =>
		rendering.find(`[data-testid="${section}-section"] img[alt="${name}"]`).exists();
}

/** A sample a Theme preview offers: a Card Game's, or a Commander Event's, a pick beside them (ADR-0087). */
type SamplePick = Game | 'commander';
const PICKS: Record<SamplePick, { game: Game; variant?: Variant }> = {
	mtg: { game: 'mtg' },
	commander: { game: 'mtg', variant: 'commander' },
	op: { game: 'op' },
};

/** What each mode shows of each sample, where its defaults alone would show nothing. */
const SHOWS: Record<SamplePick, Partial<Record<ScreenMode, Shown>>> = {
	op: {
		card: (rendering) =>
			rendering
				.find(
					'[data-testid="spotlight-card"] img[src="https://cards-img.keepr.digital/OP05-119_p1.png"]',
				)
				.exists(),
		deck: (rendering) =>
			opCard('OP09-080')(rendering) &&
			rendering.find('[data-testid="op-deck-leader"][data-number="OP05-060"]').exists() &&
			text('Sebastián Castellanos-Ruiz')(rendering),
		'broadcast-graphics': text('Monkey.D.Luffy · Purple'),
		'feature-match-overlay': text('Enel'),
		metagame: text('Roronoa Zoro'),
		'top-cards': (rendering) =>
			rendering
				.find(
					'[data-testid="top-cards-item"] img[src="https://cards-img.keepr.digital/OP05-119.png"]',
				)
				.exists(),
		'archetype-spotlight': text('Hana Kobayashi'),
		'top-cut': text('Priya Raman'),
		talent: text('Jordan Reyes'),
	},
	mtg: {
		card: (rendering) => rendering.find('[data-testid="spotlight-card"] img').exists(),
		standings: text('Alexandra Whitfield-Moreau'),
		deck: deckCard('Gleeful Demolition'),
		'top-cut': text('Tomás Ó Briain'),
		'broadcast-graphics': text('Boros Convoke · 6-0-1'),
		'feature-match-overlay': text('Dimir Midrange'),
		metagame: text('Mono-Green Landfall'),
		'top-cards': text('Lightning Helix'),
		'player-history': text('Maximilian Hohenberger'),
		pairings: text('Ana Lúcia Ferreira'),
		'archetype-spotlight': text('Jo Lee'),
		'head-to-head': text('Kenji Sato'),
		'round-clock': text('50:00'),
		talent: text('Sam Okafor'),
	},
	commander: {
		card: (rendering) => rendering.find('[data-testid="spotlight-card"] img').exists(),
		// A Commander Seat's deck: its Commanders apart, ahead of its Mainboard.
		deck: (rendering) =>
			inSection('commanders', 'Tymna the Weaver')(rendering) &&
			inSection('commanders', "Kraum, Ludevic's Opus")(rendering) &&
			inSection('mainboard', 'Sol Ring')(rendering) &&
			text('Oluwaseun Adebayo-Lindqvist')(rendering),
		// The table's four Seats, each by name and Commanders, as Commander Table seats them (ADR-0087).
		'broadcast-graphics': (rendering) =>
			['Oluwaseun Adebayo-Lindqvist', 'Bo Li', 'Marguerite Okafor', 'Tomás Reyes'].every((name) =>
				text(name)(rendering),
			) && text("Tymna the Weaver / Kraum, Ludevic's Opus")(rendering),
		'feature-match-overlay': text('Tomás Reyes'),
		talent: text('Sam Okafor'),
	},
};

const MODES = [...new Set([...BACKGROUND_LAYERS_CAPABLE_MODES, ...THEME_PREVIEW_SCREEN_MODES])];

const CASES = (['mtg', 'commander', 'op'] as const).flatMap((pick) =>
	MODES.filter((mode) =>
		isOfferedToEvent(SCREEN_MODES[mode].offeredTo, eventKind(PICKS[pick])),
	).map((mode) => ({ pick, mode })),
);

describe('the Screen Mode Sample Dataset', () => {
	it.each(CASES)('fills the $pick $mode display with no request', async ({ pick, mode }) => {
		const { game, variant } = PICKS[pick];
		const shows = SHOWS[pick][mode];
		expect(shows, `name what ${mode} shows of the ${pick} sample`).toBeDefined();
		// One Piece cards are Printing images, loaded off-DOM before they show.
		if (game === 'op') stubImageLoading();
		wrapper = mount(PreviewTile, {
			props: {
				mode,
				game,
				variant,
				label: SCREEN_MODES[mode].label,
				tokens: {},
			},
			global: {
				stubs: { MtgManaColorDisplay: true },
			},
		});

		await settleUntil(() => {
			loadDrawnImages(wrapper!);
			return shows!(wrapper!);
		});

		expect(shows!(wrapper)).toBe(true);
		expect(
			[...mockFetch.mock.calls, ...browserFetch.mock.calls].map(([url]) => String(url)),
		).toEqual([]);
	});
});
