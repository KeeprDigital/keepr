import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { effectScope, ref } from 'vue';
import { deferred } from '@keepr/nuxt-layer/test/helpers/deferred';

// The card data a deck view shows follows the deck shown: an answer for a deck
// left behind never lands. Scryfall's batch is faked, answering by hand.

type Answer = { cards: Map<string, unknown>; degraded: boolean };
const answers: Array<ReturnType<typeof deferred<Answer>>> = [];
mockNuxtImport('useScryfallBatch', () => () => ({
	fetchScryfallCards: vi.fn(() => {
		const answer = deferred<Answer>();
		answers.push(answer);
		return answer.promise;
	}),
}));

const deckOf = (name: string) => ({ cards: [{ name, scryfallId: `${name}-id` }] });
const answerFor = (name: string): Answer => ({
	cards: new Map([[`${name}-id`, { name }]]),
	degraded: false,
});

describe('useDeckCardData', () => {
	it.each([
		{ order: 'the later deck answers first', settle: [1, 0] },
		{ order: 'the earlier deck answers first', settle: [0, 1] },
	])("shows the later deck's cards when $order", async ({ settle }) => {
		answers.length = 0;
		const shown = ref(deckOf('Bolt'));
		const scope = effectScope();
		const cardData = scope.run(() => useDeckCardData(() => shown.value))!;
		shown.value = deckOf('Ragavan');
		await flushPromises();
		const names = ['Bolt', 'Ragavan'];

		for (const index of settle) {
			answers[index]!.resolve(answerFor(names[index]!));
			await flushPromises();
		}

		expect([...cardData.value.keys()]).toEqual(['Ragavan-id']);
		scope.stop();
	});
});
