<script lang="ts" setup>
const matchStore = useMatchStore()
const match = computed(() => matchStore.state[0])
</script>

<template>
  <div v-if="match" class="container">
    <div class="player-one">
      {{ match.playerOne.name }}
    </div>

    <div class="player-two">
      {{ match.playerTwo.name }}
    </div>
  </div>
</template>

<style scoped>
.container {
  display: grid;
  
}
</style>
