import { vi } from 'vitest';

/**
 * `useScryfallBatch` with its card data fetch faked: every printing asked for
 * by Scryfall id answers `cardOf(id)`, and nothing is degraded. The rest is
 * the real composable. Pass it to `mockNuxtImport('useScryfallBatch', …)`.
 *
 * `answering`, read at each fetch, is false while Scryfall is down: the fetch
 * then answers no card and reports degraded, as one whose retries ran out does.
 */
export async function scryfallBatchAnswering(
	cardOf: (scryfallId: string) => unknown,
	answering: () => boolean = () => true,
) {
	const actual = await vi.importActual<typeof import('~/composables/data/useScryfallBatch')>(
		'~/composables/data/useScryfallBatch',
	);
	return () => ({
		...actual.useScryfallBatch(),
		fetchScryfallCards: async (cards: Array<{ scryfallId: string | null }>) => {
			if (!answering()) {
				return {
					cards: new Map(),
					degraded: true,
				};
			}
			return {
				cards: new Map(
					cards.flatMap((card) =>
						card.scryfallId ? [[card.scryfallId, cardOf(card.scryfallId)]] : [],
					),
				),
				degraded: false,
			};
		},
	});
}
