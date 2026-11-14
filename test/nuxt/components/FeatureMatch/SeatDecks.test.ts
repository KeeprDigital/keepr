import type { FeatureMatchMenuSeatDeck } from '~/composables/featureMatch/useFeatureMatchMenuItems';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import { LAW, ZORO } from '~~/test/helpers/opCards';
import SeatDecks from '~/components/FeatureMatch/SeatDecks.vue';

const ColorsStub = defineComponent({
	props: {
		colors: {
			type: [String, Array],
			required: true,
		},
	},
	template: '<i :data-colors="String(colors)" />',
});

function mtg(deckName: string, colors: string | null = null): FeatureMatchMenuSeatDeck {
	return { deckName, colors, leader: null };
}

function op(leader: FeatureMatchMenuSeatDeck['leader']): FeatureMatchMenuSeatDeck {
	return { deckName: null, colors: null, leader };
}

// A Slot's decks read under it, one per Seat that holds one, in Seat order.
describe('featureMatchSeatDecks', () => {
	it.each([
		{
			name: 'a pair\'s two decks',
			decks: [
				mtg('Mono Red', 'R'),
				mtg('Azorius Control', 'WU'),
			],
			lines: ['Mono Red vs Azorius Control'],
			colors: ['R', 'WU'],
		},
		{
			name: 'a Commander Slot\'s four decks',
			decks: [
				mtg('Atraxa'),
				mtg('Krenko'),
				mtg('Edgar'),
				mtg('Kinnan'),
			],
			lines: ['Atraxa vs Krenko vs Edgar vs Kinnan'],
			colors: [],
		},
		{
			name: 'one deck alone',
			decks: [
				mtg('Krenko'),
			],
			lines: ['Krenko'],
			colors: [],
		},
		{
			name: 'One Piece Leaders',
			decks: [
				op(ZORO),
				op(LAW),
			],
			lines: [`${ZORO.name} vs ${LAW.name}`],
			colors: [
				String(ZORO.colors),
				String(LAW.colors),
			],
		},
		{
			name: 'nothing',
			decks: [],
			lines: [],
			colors: [],
		},
	])('reads $name', ({ decks, lines, colors }) => {
		const wrapper = mount(SeatDecks, {
			props: { decks },
			global: {
				stubs: { MtgManaColorDisplay: ColorsStub, OpColorDisplay: ColorsStub },
			},
		});

		expect(wrapper.findAll('[data-testid="seat-decks"]').map(line => line.findAll('span').map(span => span.text()).join(' '))).toEqual(lines);
		expect(wrapper.findAll('[data-colors]').map(color => color.attributes('data-colors'))).toEqual(colors);
	});
});
