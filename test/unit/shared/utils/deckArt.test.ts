import type { DeckModeConfig } from '~~/shared/types/screenConfig';
import type { DeckArtInput } from '~~/shared/utils/deckArt';
import { describe, expect, it } from 'vitest';
import { DECK_ART_WIDTHS, deckArtSizes } from '~~/shared/utils/deckArt';
import { solveDeckLayout } from '~~/shared/utils/deckLayout';

function input(overrides: Partial<DeckArtInput> = {}): DeckArtInput {
	return {
		config: {},
		counts: { commanders: 0, mainboard: 100, sideboard: 0 },
		canvas: { width: 1920, height: 1080 },
		pixelRatio: 1,
		...overrides,
	};
}

describe('deckArtSizes', () => {
	// Each board draws the smallest Scryfall image no narrower than its widest card, in output pixels.
	it.each([
		{
			name: 'a hundred-card grid on a 1080p output',
			overrides: {},
			board: 'mainboard',
			art: 'small',
		},
		{
			name: 'the same grid on an output at twice the canvas',
			overrides: { pixelRatio: 2 },
			board: 'mainboard',
			art: 'normal',
		},
		{
			name: 'a 4K canvas scaled into a 1080p output',
			overrides: {
				canvas: { width: 3840, height: 2160 },
				pixelRatio: 0.5,
			},
			board: 'mainboard',
			art: 'small',
		},
		{
			name: 'a constructed deck\'s thirty cards',
			overrides: {
				counts: { commanders: 0, mainboard: 30, sideboard: 0 },
			},
			board: 'mainboard',
			art: 'normal',
		},
		{
			name: 'thirty cards in one row of set columns',
			overrides: {
				counts: { commanders: 0, mainboard: 30, sideboard: 0 },
				config: {
					mainboard: { columns: 30 },
				},
			},
			board: 'mainboard',
			art: 'small',
		},
		{
			name: 'thirty cards held to a 140 px max',
			overrides: {
				counts: { commanders: 0, mainboard: 30, sideboard: 0 },
				config: {
					mainboard: { maxCardSize: 140 },
				},
			},
			board: 'mainboard',
			art: 'small',
		},
		{
			name: 'a listed board, warmed at its grid\'s size',
			overrides: {
				config: {
					mainboard: { view: 'list' },
				},
			},
			board: 'mainboard',
			art: 'small',
		},
		{
			name: 'a Seat\'s Commanders, beside its hundred cards',
			overrides: {
				counts: { commanders: 2, mainboard: 100, sideboard: 0 },
			},
			board: 'commanders',
			art: 'normal',
		},
		{
			name: 'a hundred-card stacked sideboard, whose strip shows a card whole',
			overrides: {
				counts: { commanders: 0, mainboard: 0, sideboard: 100 },
				config: {
					sideboard: { view: 'stack' },
				},
			},
			board: 'sideboard',
			art: 'normal',
		},
		{
			name: 'a companion, beside a hundred-card sideboard grid',
			overrides: {
				counts: { commanders: 0, mainboard: 0, sideboard: 100 },
				config: {
					sideboard: { view: 'grid' },
				},
			},
			board: 'companion',
			art: 'normal',
		},
	] as const)('$name: $art', ({ overrides, board, art }) => {
		const sizes = deckArtSizes(input({
			...overrides,
			config: overrides.config as Partial<DeckModeConfig> | undefined ?? {},
		}));

		expect(sizes[board]).toBe(art);
	});

	// Small art is chosen only where the Deck's layout never solves a card wider than it.
	it('covers the card a hundred-card Seat solves to on the whole canvas', () => {
		const canvas = { width: 1920, height: 1080 };
		const sizes = deckArtSizes(input({
			counts: { commanders: 2, mainboard: 100, sideboard: 0 },
			canvas,
		}));
		const layout = solveDeckLayout({
			width: canvas.width,
			height: canvas.height,
			boardGap: 24,
			placement: 'beside',
			mainboard: {
				view: 'grid',
				count: 100,
				gap: null,
				columns: null,
				labelHeight: 0,
			},
			sideboard: {
				view: 'grid',
				count: 2,
				gap: null,
				columns: null,
				labelHeight: 0,
			},
		})!;

		expect(sizes.mainboard).toBe('small');
		expect(DECK_ART_WIDTHS.small).toBeGreaterThanOrEqual(layout.cardWidth);
	});
});
