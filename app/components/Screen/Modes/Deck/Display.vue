<script setup lang="ts">
import { eventKind } from '~~/shared/config/games';
import { resolveScreenModeConfig } from '~~/shared/types/screenConfig';

/**
 * The Deck List Screen Mode: a One Piece Card Game Deck List from a Feature
 * Match Slot Seat or a Player (ADR-0057, ADR-0074), or a Magic: The Gathering
 * deck: a Player's, a Broadcast Deck List's, or a Commander Seat's (ADR-0087).
 * The kind of Event previewed, or the Event's, picks the layout. A Seat is a Deck
 * Source on a One Piece Card Game Event and a Commander Event alone.
 */
const { screen, sampleDataset, sampleVariant } = useScreenContext();
const eventStore = useEventStore();
/** The kind of Event shown: the Theme preview's sample's, or else the Event's. */
const kind = computed(() => {
	if (sampleDataset)
		return eventKind({ game: sampleDataset, variant: sampleVariant });
	const event = eventStore.displayEvent;
	return event
		? eventKind(event)
		: undefined;
});
const followsSlot = computed(() =>
	resolveScreenModeConfig(screen.value?.modeConfigs, 'deck').deckSource.type === 'featureMatchSlot');
const showsCommanderSeat = computed(() => followsSlot.value && kind.value === 'mtg-commander');
const showsOnePiece = computed(() => !showsCommanderSeat.value && (kind.value === 'op' || followsSlot.value));
</script>

<template>
	<ScreenModesDeckOpDisplay v-if="showsOnePiece" />
	<!-- Keyed, so a display set up to follow a Seat is never reused for another source. -->
	<ScreenModesDeckMtgDisplay v-else :key="showsCommanderSeat ? 'seat' : 'deck'" :follows-seat="showsCommanderSeat" />
</template>
