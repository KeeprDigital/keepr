import type { MtgCard } from '~/types/card/mtg';
import { createDeckLookupCards } from '~~/shared/utils/playerDeck';
import { createGuardedSequence } from '@keepr/nuxt-layer/app/utils/guardedSequence';

type LookupDeck = {
	cards: Parameters<typeof createDeckLookupCards>[0];
	companion?: Parameters<typeof createDeckLookupCards>[1];
};

/**
 * The Scryfall card data of the deck a view shows, by name. Emptied the moment
 * the deck changes, and only the answer for the deck still shown lands: an
 * earlier, slower answer never overwrites a later one.
 */
export function useDeckCardData(deck: () => LookupDeck | null | undefined) {
	const { fetchScryfallCards } = useScryfallBatch();
	const cardDataMap = shallowRef(new Map<string, MtgCard>());
	const reads = createGuardedSequence();

	watch(
		deck,
		async (shown) => {
			const read = reads.begin();
			cardDataMap.value = new Map();
			if (!shown) return;
			const { cards } = await fetchScryfallCards(
				createDeckLookupCards(shown.cards, shown.companion),
			);
			if (read.current) cardDataMap.value = cards;
		},
		{ immediate: true },
	);

	return cardDataMap;
}
