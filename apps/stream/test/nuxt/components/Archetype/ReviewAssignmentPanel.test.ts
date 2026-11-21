import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { nuxtUiStubs } from '@keepr/nuxt-layer/test/nuxt/helpers/nuxtUiStubs';
import ReviewAssignmentPanel from '~/components/Archetype/ReviewAssignmentPanel.vue';

function mountPanel(props: Record<string, unknown> = {}) {
	return mount(ReviewAssignmentPanel, {
		props: {
			nameInput: 'Boros Burn',
			colorsInput: ['R'],
			saving: false,
			isEditMode: true,
			isNameValid: true,
			matchesExistingArchetype: null,
			matchingArchetypeId: null,
			buttonLabel: 'Rename for all 3 decks',
			canSplit: false,
			impactNote: null,
			sortedArchetypes: [],
			archetypePlayerCounts: new Map(),
			archetypeKeyCardMatches: new Map(),
			...props,
		},
		global: {
			stubs: {
				...nuxtUiStubs,
				MtgManaColorPicker: true,
				MtgManaColorDisplay: true,
			},
		},
	});
}

const button = (wrapper: ReturnType<typeof mountPanel>, label: string) =>
	wrapper.findAll('button').find((candidate) => candidate.text() === label);

describe('archetype review assignment panel', () => {
	it.each([
		['the accept action', 'Rename for all 3 decks', {}, 'accept'],
		[
			'a new Archetype for this deck, where the rename can be one instead',
			'New archetype for this deck',
			{ canSplit: true },
			'createForDeck',
		],
		['clearing the assignment of a reviewed deck', 'Clear assignment', {}, 'clearAssignment'],
	])('offers %s', async (_case, label, props, event) => {
		const wrapper = mountPanel(props);

		await button(wrapper, label)!.trigger('click');

		expect(wrapper.emitted(event)).toHaveLength(1);
	});

	it.each([
		[
			'no new Archetype for this deck where only the rename is offered',
			'New archetype for this deck',
			{ canSplit: false },
		],
		['no clearing for a deck not yet reviewed', 'Clear assignment', { isEditMode: false }],
	])('offers %s', (_case, label, props) => {
		expect(button(mountPanel(props), label)).toBeUndefined();
	});

	// A chip assigns the deck shown: never one the reviewer has not seen yet.
	it.each([
		{ state: 'while the next deck loads', props: { deckLoading: true }, disabled: true },
		{ state: 'while saving', props: { saving: true }, disabled: true },
		{ state: 'once the deck is shown', props: {}, disabled: false },
	])('offers the Archetype chips $state: disabled $disabled', async ({ props, disabled }) => {
		const burn = { id: 5, name: 'Burn', colors: 'R', keyCards: [] };
		const wrapper = mountPanel({ ...props, isEditMode: false, sortedArchetypes: [burn] });

		const chip = wrapper
			.findAll('button')
			.find((candidate) => candidate.text().startsWith('Burn'))!;
		await chip.trigger('click');

		expect(chip.attributes('disabled') !== undefined).toBe(disabled);
		expect(wrapper.emitted('chipClick')?.length ?? 0).toBe(disabled ? 0 : 1);
	});

	it('says what else the save changes, when it changes more than this deck', () => {
		const note = 'Also updates “Control” for 3 other decks.';

		expect(mountPanel({ impactNote: note }).get('[data-impact-note]').text()).toBe(note);
		expect(mountPanel().find('[data-impact-note]').exists()).toBe(false);
	});
});
