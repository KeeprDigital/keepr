<script setup lang="ts">
definePageMeta({
  layout: 'display',
})

const configStore = useConfigStore()

const mtgCard = resolveComponent('MtgCardDisplay')
const opCard = resolveComponent('OpCardDisplay')
</script>

<template>
  <component :is="configStore.tournament.game === 'mtg' ? mtgCard : opCard" />
</template>
