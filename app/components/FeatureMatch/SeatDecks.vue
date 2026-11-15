<script setup lang="ts">
import type { FeatureMatchMenuSeatDeck } from '~/composables/featureMatch/useFeatureMatchMenuItems';

/**
 * The decks under a Feature Match Slot in a picker: every Seat that holds one,
 * in Seat order, so a Commander Slot reads all four (ADR-0087). A One Piece
 * Seat's deck is its Leader.
 */
const props = defineProps<{
	decks: FeatureMatchMenuSeatDeck[];
}>();

const mtgDecks = computed(() => props.decks.filter((deck) => deck.deckName));
const leaders = computed(() => props.decks.flatMap((deck) => (deck.leader ? [deck.leader] : [])));
</script>

<template>
	<div
		v-if="mtgDecks.length > 0"
		data-testid="seat-decks"
		class="flex items-center gap-1 text-xs text-muted"
	>
		<template v-for="(deck, index) in mtgDecks" :key="index">
			<span v-if="index > 0" class="text-dimmed">vs</span>
			<MtgManaColorDisplay v-if="deck.colors" :colors="deck.colors" size="xs" />
			<span>{{ deck.deckName }}</span>
		</template>
	</div>
	<div
		v-if="leaders.length > 0"
		data-testid="seat-decks"
		class="flex items-center gap-1 text-xs text-muted"
	>
		<template v-for="(leader, index) in leaders" :key="index">
			<span v-if="index > 0" class="text-dimmed">vs</span>
			<OpColorDisplay :colors="leader.colors" size="xs" />
			<span>{{ leader.name }}</span>
		</template>
	</div>
</template>
