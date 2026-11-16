import type { EventKind } from '~~/shared/config/games';
import type { OpLeader } from '~~/shared/types/game';
import { eventSeats } from '~~/shared/config/games';
import { featureMatchSidePlayer } from '~~/shared/utils/featureMatchSidePlayer';
import { getMtgGameData, getOpGameData } from '~~/shared/utils/gameData';
import { playerDisplayName } from '~~/shared/utils/playerName';

/** One Seat's deck as a picker names it under its Slot. */
export interface FeatureMatchMenuSeatDeck {
	deckName: string | null;
	colors: string | null;
	/** A One Piece Seat's Leader, which names its deck. */
	leader: OpLeader | null;
}

export interface FeatureMatchMenuItem {
	label: string;
	value: number;
	/** Each Seat that holds a deck or a Leader, in Seat order. */
	decks: FeatureMatchMenuSeatDeck[];
}

function seatDeck(
	playerData:
		| { name?: string | null; nickname?: string | null; gameData?: unknown }
		| null
		| undefined,
): FeatureMatchMenuSeatDeck | null {
	if (!playerData || !playerDisplayName(playerData)) return null;
	const gameData = playerData.gameData as Parameters<typeof getMtgGameData>[0];
	const mtg = getMtgGameData(gameData);
	const deck = {
		deckName: mtg.deckName ?? null,
		colors: mtg.deckColors ?? null,
		leader: getOpGameData(gameData).leader ?? null,
	};
	return deck.deckName || deck.leader ? deck : null;
}

/**
 * A Slot's label, "Match N — A vs B". A pair's empty side reads TBD; a
 * Commander Slot names every Seat somebody sits in and passes over an empty
 * one, which is not in the game (ADR-0087).
 */
function formatMatchLabel(
	names: Array<string | null>,
	kind: EventKind | undefined,
	index: number,
): string {
	const prefix = `Match ${index + 1}`;
	if (names.every((name) => !name)) return prefix;
	const shown =
		kind === 'mtg-commander'
			? names.filter((name): name is string => !!name)
			: names.map((name) => name ?? 'TBD');
	return `${prefix} — ${shown.join(' vs ')}`;
}

/**
 * Each Feature Match Slot as a picker offers it, "A vs B", its players in the
 * order its followed Session seats them (ADR-0058), and a Commander Slot's
 * filled Seats in Seat order; under it, each of those Seats' decks.
 */
export function useFeatureMatchMenuItems() {
	const featureMatchStore = useFeatureMatchStore();
	const featureMatchStateStore = useFeatureMatchStateStore();
	const eventKind = useEventKind();

	const items = computed<FeatureMatchMenuItem[]>(() => {
		return featureMatchStore.featureMatches.map((match, index) => {
			const slot = withFollowedFeatureMatchSession(match, featureMatchStateStore);
			const players = eventSeats(eventKind.value ?? 'mtg-two-player').map(
				(seat) => featureMatchSidePlayer(slot, seat).data,
			);

			return {
				label: formatMatchLabel(
					players.map((player) => playerDisplayName(player) || null),
					eventKind.value,
					index,
				),
				value: match.id,
				decks: players.map(seatDeck).filter((deck): deck is FeatureMatchMenuSeatDeck => !!deck),
			};
		});
	});

	return items;
}
