import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, nextTick, ref } from 'vue';
import { createMockUiArchetype } from '~~/test/helpers/fixtures';

// Key cards the reviewer toggled survive whatever the save or a peer does to the
// Archetype meanwhile. A real Archetype store; its repository and the key-card
// PATCH are faked at the network.

const mockRepo = vi.hoisted(() => ({
	list: vi.fn(),
	getById: vi.fn(),
	create: vi.fn(),
	update: vi.fn(),
	remove: vi.fn(),
}));
vi.mock('~/modules/event-data/client', async (importOriginal) => ({
	...(await importOriginal<typeof import('~~/app/modules/event-data/client')>()),
	useEventDataResource: () => mockRepo,
}));

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));
mockNuxtImport('$fetch', () => mockFetch);

const reviewDeck = vi.fn(async () => ({}));
mockNuxtImport('usePlayerDeckStore', () => () => ({
	reviewDeck,
	clearDeckReview: vi.fn(),
	applyArchetypeUpdated: vi.fn(),
	applyArchetypeDeleted: vi.fn(),
	applyArchetypeMerged: vi.fn(),
}));
mockNuxtImport('useFeatureMatchStore', () => () => ({ loadFeatureMatchesByEventId: vi.fn() }));
mockNuxtImport('useMetagameStore', () => () => ({ applyRemoteInvalidated: vi.fn() }));
mockNuxtImport('useToast', () => () => ({ add: vi.fn() }));

const card = (name: string, id: number) => ({
	id,
	name,
	game: 'mtg',
	scryfallId: null,
	cardType: null,
	colors: null,
	cmc: null,
	manaCost: null,
});
const BURN = createMockUiArchetype({
	id: 5,
	name: 'Burn',
	colors: 'R',
	keyCards: [card('Lightning Bolt', 1)] as never,
});

function review(reviewed: boolean) {
	const entry = {
		player: { id: 10, eventId: 1 },
		deck: {
			id: 70,
			playerId: 10,
			archetypeId: reviewed ? BURN.id : null,
			reviewedAt: reviewed ? new Date() : null,
		},
		displayName: 'Burn',
		displayColors: 'R',
	};
	return useArchetypeAssignment({
		currentEntry: computed(() => entry as never),
		activeDeck: ref(null),
		eventId: computed(() => 1),
		prepareAdvance: () => ({ commit: vi.fn(), cancel: vi.fn() }),
		archetypePlayerCounts: computed(() => new Map([[BURN.id, 1]])),
	});
}

/** The key cards stored on Burn, as the store holds them. */
function storedKeyCards() {
	return useArchetypeStore()
		.archetypes.find((archetype) => archetype.id === BURN.id)!
		.keyCards!.map((keyCard) => keyCard.name);
}

beforeEach(() => {
	vi.clearAllMocks();
	useArchetypeStore().$dispose();
	useArchetypeStore().archetypes = [structuredClone(BURN)];
	mockRepo.update.mockImplementation(async (_eventId, id, input) => ({
		...useArchetypeStore().archetypes.find((archetype) => archetype.id === id)!,
		...input,
	}));
	mockFetch.mockImplementation(async (_url: string, init: { body: { cardNames: string[] } }) => ({
		keyCards: init.body.cardNames.map((name, index) => card(name, index + 1)),
	}));
});

describe('a key-card edit beside an Archetype write', () => {
	it.each([
		{
			save: 'a rename',
			reviewed: true,
			edit: (assignment: ReturnType<typeof review>) => {
				assignment.nameInput.value = 'Boros Burn';
			},
			label: 'Rename archetype',
		},
		{
			save: 'an Update & Assign',
			reviewed: false,
			edit: (assignment: ReturnType<typeof review>) => {
				assignment.colorsInput.value = ['R', 'W'];
			},
			label: 'Update & Assign',
		},
	])('$save saves the key cards toggled', async ({ reviewed, edit, label }) => {
		const assignment = review(reviewed);
		await nextTick();
		edit(assignment);
		assignment.toggleKeyCard('Goblin Guide');
		await nextTick();
		expect(assignment.buttonLabel.value).toBe(label);

		await assignment.acceptName();

		expect(storedKeyCards()).toEqual(['Lightning Bolt', 'Goblin Guide']);
	});

	it('keeps the toggles in progress when a peer updates the Archetype', async () => {
		const assignment = review(true);
		await nextTick();
		assignment.toggleKeyCard('Goblin Guide');

		useArchetypeStore().applyRemoteUpdated({
			archetype: { ...BURN, colors: 'RW' },
		} as never);
		await nextTick();

		expect([...assignment.selectedKeyCards.value]).toEqual(['Lightning Bolt', 'Goblin Guide']);
	});
});
