<script lang="ts" setup>
const emit = defineEmits<{
  (e: 'close'): void
}>()

const opCardStore = useOpCardStore()

function selectCard(card: OpCardData) {
  opCardStore.selectPreviewCard(card)
  emit('close')
}

function clearHistory() {
  opCardStore.clearHistory()
  emit('close')
}
</script>

<template>
  <UModal
    title="History"
    description="previously selected cards"
    :ui="{
      content: 'sm:max-w-screen-xl',
    }"
  >
    <template #body>
      <div class="card-list">
        <div
          v-for="(card, index) in opCardStore.selectionHistory"
          :key="index"
          class="card-list-item"
        >
          <OpCardImage
            class="card-list-item-image"
            :card="card"
            :hoverable="true"
            @click="selectCard(card)"
          />
          <div class="card-list-item-title">
            {{ card.name }}
          </div>
        </div>
        <div class="card-list-item" />
        <div class="card-list-item" />
        <div class="card-list-item" />
        <div class="card-list-item" />
      </div>
    </template>
    <template #footer>
      <UButton @click="clearHistory">
        Clear
      </UButton>
    </template>
  </UModal>
</template>

<style scoped>
.card-list {
  display: flex;
  flex-flow: row wrap;
  justify-content: space-between;
  row-gap: 0.75rem;

  .card-list-item {
    width: 19%;

    .card-list-item-title {
      text-align: center;
      font-size: 1rem;
    }

    .card-list-item-image {
      width: 100%;
    }
  }
}
</style>
