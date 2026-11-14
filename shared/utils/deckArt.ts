import type { EventCanvas } from '../eventCanvas';
import type { DeckModeConfig, ResolvedDeckBoardLayout } from '../types/screenConfig';
import { resolveDeckBoards } from '../types/screenConfig';
import { CARD_ASPECT } from './cardGrid';

/** The Scryfall card images a Deck List draws, by the width Scryfall serves each at. */
export const DECK_ART_WIDTHS = { small: 146, normal: 488 } as const;
export type DeckArtSize = keyof typeof DECK_ART_WIDTHS;

/** What a Deck List draws card art for: its boards, a Seat's Commanders and the companion. */
export type DeckArtBoard = 'commanders' | 'mainboard' | 'sideboard' | 'companion';

export interface DeckArtInput {
	config: Partial<DeckModeConfig>;
	/** Each board's cards: one per Deck List entry, a grid cell. */
	counts: { commanders: number; mainboard: number; sideboard: number };
	canvas: EventCanvas;
	/** Output pixels per Event Canvas pixel: the output's fit scale times its device pixel ratio. */
	pixelRatio: number;
}

/**
 * The widest a board's card can be on the whole Event Canvas, with no header,
 * label, gap or other board: at its set columns, or at whichever column count
 * gives the widest card. Whatever the Deck's layout solves is never wider.
 */
function widestCard(count: number, layout: Pick<ResolvedDeckBoardLayout, 'columns' | 'maxCardSize'>, canvas: EventCanvas): number {
	const cards = Math.max(1, count);
	const widestAt = (columns: number) => Math.min(
		canvas.width / columns,
		canvas.height * CARD_ASPECT / Math.ceil(cards / columns),
	);
	let widest = 0;
	if (typeof layout.columns === 'number') {
		widest = widestAt(Math.max(1, Math.min(cards, Math.floor(layout.columns))));
	}
	else {
		for (let columns = 1; columns <= cards; columns++)
			widest = Math.max(widest, widestAt(columns));
	}
	return Math.min(widest, layout.maxCardSize ?? Number.POSITIVE_INFINITY);
}

/** The smallest Scryfall image no narrower than `width` output pixels; `normal` past it. */
function artFor(width: number): DeckArtSize {
	return width <= DECK_ART_WIDTHS.small
		? 'small'
		: 'normal';
}

/**
 * The Scryfall image each board's cards draw (#1201): the smallest no
 * narrower than the board's widest card on its output, so a hundred-card grid
 * loads a tenth of the bytes and no card is drawn from an upscaled image. A
 * listed or hidden board is sized as its grid, so the art it warms is the art
 * a switch to that grid draws. A stacked strip shows a card whole, so it is
 * sized as one card; so is the companion, which may stand alone.
 */
export function deckArtSizes({ config, counts, canvas, pixelRatio }: DeckArtInput): Record<DeckArtBoard, DeckArtSize> {
	const boards = resolveDeckBoards(config);
	const art = (count: number, layout: Pick<ResolvedDeckBoardLayout, 'columns' | 'maxCardSize'>) =>
		artFor(widestCard(count, layout, canvas) * pixelRatio);
	return {
		// A Seat's Commanders are laid out as the sideboard's cards are, in columns of their own (ADR-0087).
		commanders: art(counts.commanders, { ...boards.sideboard, columns: undefined }),
		mainboard: art(counts.mainboard, boards.mainboard),
		sideboard: art(boards.sideboard.view === 'stack'
			? 1
			: counts.sideboard, boards.sideboard),
		companion: art(1, { ...boards.sideboard, columns: undefined }),
	};
}
