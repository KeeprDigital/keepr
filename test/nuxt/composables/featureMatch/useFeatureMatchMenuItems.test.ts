import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LAW, ZORO } from '~~/test/helpers/opCards';
import { createFollowedFeatureMatchSessions, followNoSession, followSwappedSession } from '~~/test/nuxt/helpers/followedFeatureMatchSession';

const alice = {
	name: 'Alice',
	gameData: { type: 'mtg', deckName: 'Azorius Control', deckColors: 'WU' },
};
const bob = {
	name: 'Bob',
	gameData: { type: 'mtg', deckName: 'Mono Red', deckColors: 'R' },
};
const ana = {
	name: 'Ana',
	gameData: { type: 'op', leader: ZORO },
};
const ben = {
	name: 'Ben',
	gameData: { type: 'op', leader: LAW },
};

const mockMatches = [
	{
		id: 1,
		player1Id: 11,
		player1Data: alice,
		player2Id: 12,
		player2Data: bob,
	},
	{
		id: 2,
		player1Data: { name: 'Charlie', gameData: null },
		player2Data: null,
	},
	// A One Piece Slot seats typed players, with no Player ids (ADR-0057).
	{
		id: 3,
		player1Id: null,
		player1Data: ana,
		player2Id: null,
		player2Data: ben,
	},
	// A Commander Slot seats four, typed; Seat 2 sits empty here (ADR-0087).
	{
		id: 4,
		player1Id: null,
		player1Data: { name: 'Dana', gameData: null },
		player2Id: null,
		player2Data: null,
		player3Data: {
			name: 'Eve',
			gameData: { type: 'mtg', deckName: 'Atraxa', deckColors: 'WUBG' },
		},
		player4Data: {
			name: 'Finn',
			gameData: { type: 'mtg', deckName: 'Krenko', deckColors: 'R' },
		},
	},
	{
		id: 5,
		player1Id: null,
		player1Data: null,
		player2Id: null,
		player2Data: null,
	},
];

const { mockEventKind } = vi.hoisted(() => ({
	mockEventKind: { value: 'mtg-two-player' as string },
}));
mockNuxtImport('useEventKind', () => () => mockEventKind);

const followed = createFollowedFeatureMatchSessions();

mockNuxtImport('useFeatureMatchStore', () => () => ({ featureMatches: mockMatches }));
mockNuxtImport('useFeatureMatchStateStore', () => () => followed);

describe('useFeatureMatchMenuItems', () => {
	beforeEach(() => {
		followNoSession(followed);
		mockEventKind.value = 'mtg-two-player';
	});

	it('offers each Feature Match Slot with its Players and their decks', () => {
		expect(useFeatureMatchMenuItems().value[0]).toMatchObject({
			value: 1,
			label: 'Match 1 — Alice vs Bob',
			decks: [
				{ deckName: 'Azorius Control', colors: 'WU', leader: null },
				{ deckName: 'Mono Red', colors: 'R', leader: null },
			],
		});
	});

	// The followed Session owns which side each player sits on (ADR-0058).
	it.each([
		{
			game: 'MTG',
			slot: 1,
			session: 'no',
			label: 'Match 1 — Alice vs Bob',
			firstDeck: { deckName: 'Azorius Control', leader: null },
		},
		{
			game: 'MTG',
			slot: 1,
			session: 'a swapped',
			label: 'Match 1 — Bob vs Alice',
			firstDeck: { deckName: 'Mono Red', leader: null },
		},
		{
			game: 'OP',
			slot: 3,
			session: 'no',
			label: 'Match 3 — Ana vs Ben',
			firstDeck: { deckName: null, leader: ZORO },
		},
		{
			game: 'OP',
			slot: 3,
			session: 'a swapped',
			label: 'Match 3 — Ben vs Ana',
			firstDeck: { deckName: null, leader: LAW },
		},
	])('names a $game Slot\'s players in the order $session Session seats them', ({ game: _game, slot, session, label, firstDeck }) => {
		if (session === 'a swapped')
			followSwappedSession(followed, mockMatches.find(match => match.id === slot)!);

		const item = useFeatureMatchMenuItems().value.find(item => item.value === slot)!;
		expect(item.label).toBe(label);
		expect(item.decks[0]).toMatchObject(firstDeck);
	});

	it('lists no deck for a Seat that holds none', () => {
		expect(useFeatureMatchMenuItems().value[1]).toMatchObject({ value: 2, label: 'Match 2 — Charlie vs TBD', decks: [] });
	});

	// Every Seat of a Commander Slot that holds a deck is listed, in Seat order.
	it('lists a Commander Slot\'s third and fourth Seat decks', () => {
		mockEventKind.value = 'mtg-commander';

		expect(useFeatureMatchMenuItems().value.find(item => item.value === 4)!.decks).toEqual([
			{ deckName: 'Atraxa', colors: 'WUBG', leader: null },
			{ deckName: 'Krenko', colors: 'R', leader: null },
		]);
	});

	// A Commander Slot is labelled by every Seat somebody sits in, and an empty Seat is not in the game.
	it.each([
		{ slot: 4, label: 'Match 4 — Dana vs Eve vs Finn' },
		{ slot: 5, label: 'Match 5' },
	])('labels a Commander Slot $label', ({ slot, label }) => {
		mockEventKind.value = 'mtg-commander';

		expect(useFeatureMatchMenuItems().value.find(item => item.value === slot)!.label).toBe(label);
	});
});
