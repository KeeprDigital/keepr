import { beforeEach, describe, expect, it } from 'vitest';
import {
	createMockEvent,
	createMockPlayer,
	createMockPlayerList,
	createMockUiArchetype,
} from '~~/test/helpers/fixtures';
import { realtimeHandlersFor } from '~~/test/nuxt/helpers/realtimeEventSession';

/*
 * A peer's Player, deck, Archetype and Player List message lands in the store
 * that holds it, and every one that can move the metagame drops its summary.
 */

const { deliver } = realtimeHandlersFor();

function deckSummary(overrides: Record<string, unknown> = {}) {
	return {
		id: 10,
		playerId: 1,
		name: 'Submitted',
		colors: 'U',
		archetypeId: null,
		reviewedAt: null,
		...overrides,
	};
}

function held() {
	return {
		players: usePlayerStore().players.map(({ id, name }) => ({ id, name })),
		deckArchetypes: usePlayerDeckStore().decks.map(({ id, archetypeId }) => ({ id, archetypeId })),
		archetypes: useArchetypeStore().archetypes.map(({ id, name, keyCards }) => ({
			id,
			name,
			keyCards: keyCards?.map((card) => card.name) ?? [],
		})),
		lists: usePlayerListStore().lists.map(({ id, name, memberCount }) => ({
			id,
			name,
			memberCount,
		})),
	};
}

describe("a peer's Player and metagame messages", () => {
	beforeEach(() => {
		resetAllEventStores();
		useEventStore().event = createMockEvent({ id: 1 }) as never;
		usePlayerStore().players = [createMockPlayer({ id: 1, name: 'Ada' })] as never;
		usePlayerDeckStore().decks = [deckSummary()] as never;
		useArchetypeStore().archetypes = [
			createMockUiArchetype({ id: 5, name: 'Tempo', keyCards: [] }),
		] as never;
		usePlayerListStore().lists = [
			{ ...createMockPlayerList({ id: 3, name: 'Top 8' }), memberCount: 1 },
		] as never;
	});

	it.each([
		{
			type: 'player:created',
			payload: { player: createMockPlayer({ id: 2, name: 'Bo' }) },
			change: {
				players: [
					{ id: 1, name: 'Ada' },
					{ id: 2, name: 'Bo' },
				],
			},
			invalidates: true,
		},
		{
			type: 'player:updated',
			payload: { player: createMockPlayer({ id: 1, name: 'Ada L.' }) },
			change: { players: [{ id: 1, name: 'Ada L.' }] },
			invalidates: true,
		},
		{
			type: 'player:deleted',
			payload: { playerId: 1 },
			change: { players: [] },
			invalidates: true,
		},
		{
			type: 'playerDeck:reviewed',
			payload: { deck: deckSummary({ archetypeId: 5, reviewedAt: new Date() }) },
			change: { deckArchetypes: [{ id: 10, archetypeId: 5 }] },
			invalidates: true,
		},
		// Resolved cards change no deck summary, only the Deck Lists read later.
		{
			type: 'playerDeck:cardsResolved',
			payload: { deckIds: [10], playerIds: [1] },
			change: {},
			invalidates: true,
		},
		{
			type: 'archetype:created',
			payload: { archetype: createMockUiArchetype({ id: 6, name: 'Ramp', keyCards: [] }) },
			change: {
				archetypes: [
					{ id: 5, name: 'Tempo', keyCards: [] },
					{ id: 6, name: 'Ramp', keyCards: [] },
				],
			},
			invalidates: true,
		},
		{
			type: 'archetype:updated',
			payload: { archetype: createMockUiArchetype({ id: 5, name: 'Flash', keyCards: [] }) },
			change: { archetypes: [{ id: 5, name: 'Flash', keyCards: [] }] },
			invalidates: true,
		},
		{
			type: 'archetype:deleted',
			payload: { archetypeId: 5 },
			change: { archetypes: [] },
			invalidates: true,
		},
		{
			type: 'archetype:keyCardsUpdated',
			payload: {
				archetypeId: 5,
				keyCards: [{ archetypeId: 5, sortOrder: 0, name: 'Island' }],
			},
			change: { archetypes: [{ id: 5, name: 'Tempo', keyCards: ['Island'] }] },
			invalidates: true,
		},
		// A List's name or creation moves no Player in or out of any metagame scope.
		{
			type: 'playerList:created',
			payload: { playerList: { id: 4, name: 'Day 2' } },
			change: {
				lists: [
					{ id: 3, name: 'Top 8', memberCount: 1 },
					{ id: 4, name: 'Day 2', memberCount: 0 },
				],
			},
			invalidates: false,
		},
		{
			type: 'playerList:updated',
			payload: { playerList: { id: 3, name: 'Top 4' } },
			change: { lists: [{ id: 3, name: 'Top 4', memberCount: 1 }] },
			invalidates: false,
		},
		{
			type: 'playerList:deleted',
			payload: { listId: 3 },
			change: { lists: [] },
			invalidates: true,
		},
		{
			type: 'playerList:membersChanged',
			payload: { listId: 3, action: 'added', playerIds: [2], memberCount: 2 },
			change: { lists: [{ id: 3, name: 'Top 8', memberCount: 2 }] },
			invalidates: true,
		},
	])(
		'$type lands in its store; metagame dropped: $invalidates',
		({ type, payload, change, invalidates }) => {
			const before = held();
			const metagame = useMetagameStore();
			const version = metagame.invalidationVersion;

			deliver(type as never, payload as never);

			expect({
				held: held(),
				metagameInvalidated: metagame.invalidationVersion !== version,
			}).toEqual({ held: { ...before, ...change }, metagameInvalidated: invalidates });
		},
	);
});
